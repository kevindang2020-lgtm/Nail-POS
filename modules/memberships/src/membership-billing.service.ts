// membership-billing.service.ts — orchestrates recurring membership billing. It mirrors ai-subscription-billing: the
// engine decides what to charge and applies a charge RESULT through the dunning state machine, writing an idempotent
// membership_payments row with the tech/owner allocation snapshot, then advancing the period (on success) or stepping
// dunning + scheduling a retry (on failure). It never invents a charge: the MembershipChargePort is the only thing that
// talks to a processor, and the default adapter returns 'not_configured' until a real Fiserv/Clover merchant + saved
// card vault are wired. Money is integer cents.
import {
  addInterval, applyMembershipBillingEvent, dunningStep, renewalIdempotencyKey, prorate, renewalAllocation, cardpointeRenewalToEvent,
  type BillingInterval, type ProrationResult, type CardPointeRenewalResult,
} from './membership-billing-core';
import type { MembershipBillingRepositoryPort, BillingMembership } from './membership-billing.repository';
import type { MembershipCommsService } from './membership-comms.service';
import { workerPrincipal } from '@aipowersalon/permissions';

const DAY = 86400000;

// ── processor port (the ONLY thing that charges a card) ──
export interface MembershipChargeRequest { tenantId: string; amountCents: number; currency?: string; customerId: string; membershipId: string; idempotencyKey: string; descriptor?: string }
export interface MembershipChargeResult { status: 'succeeded' | 'failed' | 'not_configured'; processor: string; processorRef?: string | null; declineReason?: string | null }
export interface MembershipChargePort { charge(req: MembershipChargeRequest): Promise<MembershipChargeResult> }

/** Default: no processor wired → never charges, never fabricates success. This is what keeps automated billing honest
 * until a real Fiserv/Clover merchant + saved card vault exist. */
export class UnconfiguredMembershipChargeAdapter implements MembershipChargePort {
  async charge(): Promise<MembershipChargeResult> { return { status: 'not_configured', processor: 'none', processorRef: null, declineReason: 'No membership card processor configured' }; }
}

/** CardPointe (Fiserv) adapter shape: production injects a function that performs the actual CardPointe charge against
 * the member's saved profile; the response is mapped here. Not selected unless explicitly wired. */
export class CardPointeMembershipChargeAdapter implements MembershipChargePort {
  constructor(private readonly chargeFn: (req: MembershipChargeRequest) => Promise<CardPointeRenewalResult>) {}
  async charge(req: MembershipChargeRequest): Promise<MembershipChargeResult> {
    const raw = await this.chargeFn(req);
    const mapped = cardpointeRenewalToEvent(raw);
    if (!mapped.ok) return { status: 'failed', processor: 'cardpointe', processorRef: raw?.retref ?? null, declineReason: mapped.reason };
    return { status: mapped.event === 'renewal_succeeded' ? 'succeeded' : 'failed', processor: 'cardpointe', processorRef: mapped.ref, declineReason: mapped.event === 'renewal_failed' ? (raw.resptext || 'declined') : null };
  }
}

export interface SystemActor { userId: string | null; role: string }
// BUILD_PLAN Phase 9: a renewal run with no human behind it acts as the named worker principal worker:membership-billing
// (packages/permissions worker-principals.ts — checkout.process_payment + customers.view, nothing else). The audit row
// keeps a NULL user (never a fabricated id) and names the worker as the actor role.
const SYSTEM: SystemActor = { userId: null, role: 'worker:membership-billing' };

export interface ApplyResult { applied: boolean; reason?: string; status?: string; paymentId?: string; duplicate?: boolean; allocated?: { techCents: number; ownerCents: number } }
export interface RenewalResultInput { status: 'succeeded' | 'failed' | 'not_configured'; amountCents?: number; processor?: string; processorRef?: string | null; declineReason?: string | null }

export class MembershipBillingService {
  constructor(private readonly repo: MembershipBillingRepositoryPort, private readonly charger: MembershipChargePort = new UnconfiguredMembershipChargeAdapter(), private readonly comms?: Pick<MembershipCommsService, 'notifyPaymentFailed'>) {}

  /** Apply a charge RESULT for one membership's renewal. Idempotent on (membership, due-date, attempt): a replayed
   * result returns duplicate:true without re-advancing state. */
  async applyRenewalResult(membershipId: string, result: RenewalResultInput, opts: { attempt?: number; actor?: SystemActor } = {}): Promise<ApplyResult> {
    const m = await this.repo.getForBilling(membershipId);
    if (!m) return { applied: false, reason: 'not_found' };
    if (result.status === 'not_configured') return { applied: false, reason: 'charge_not_configured' };

    const attempt = Math.max(1, Math.floor(opts.attempt ?? 1));
    const actor = opts.actor ?? SYSTEM;
    const amount = Number.isFinite(result.amountCents as number) ? Math.max(0, Math.round(result.amountCents as number)) : m.priceCents;
    const dueDate = m.nextBillingAt ?? new Date();
    const idemKey = renewalIdempotencyKey(membershipId, dueDate.toISOString(), attempt);
    const success = result.status === 'succeeded';
    const alloc = success ? renewalAllocation(amount, m.techSplitPct, m.allocationTiming) : { techCents: 0, ownerCents: 0 };

    const periodStart = success ? (m.nextBillingAt ?? m.currentPeriodEnd ?? new Date()) : (m.currentPeriodStart ?? null);
    const periodEnd = success ? addInterval(periodStart as Date, m.billingInterval as BillingInterval, m.intervalCount) : (m.currentPeriodEnd ?? null);

    const rec = await this.repo.recordPayment({
      membershipId, tenantId: m.tenantId, branchId: m.branchId, customerId: m.customerId, kind: 'renewal', amountCents: amount, taxCents: 0,
      status: success ? 'succeeded' : 'failed', processor: result.processor ?? 'recorded', processorRef: result.processorRef ?? null, idempotencyKey: idemKey,
      attemptNumber: attempt, failureReason: success ? null : (result.declineReason ?? 'declined'), periodStart, periodEnd, techAllocCents: alloc.techCents, ownerAllocCents: alloc.ownerCents, settled: success,
    });
    if (rec.duplicate) return { applied: false, reason: 'duplicate', paymentId: rec.paymentId, duplicate: true };

    const transition = applyMembershipBillingEvent(m.status, success ? 'renewal_succeeded' : 'renewal_failed');

    if (success && transition.setPeriod) {
      const newStart = periodStart as Date;
      const newEnd = periodEnd as Date;
      const nextBilling = m.billingInterval === 'none' || m.billingInterval === 'custom' ? null : newEnd;
      await this.repo.advancePeriod(membershipId, { status: 'active', currentPeriodStart: newStart, currentPeriodEnd: newEnd, nextBillingAt: nextBilling, cyclesBilled: m.cyclesBilled + 1 });
      await this.repo.addActivity({ membershipId, tenantId: m.tenantId, branchId: m.branchId, customerId: m.customerId, planId: m.planId, activityType: 'renewed', customerName: m.customerName, planName: m.planName, amountCents: amount });
      await this.repo.addAudit({ membershipId, tenantId: m.tenantId, branchId: m.branchId, planId: m.planId, actorUserId: actor.userId, actorRole: actor.role, action: 'renewal_succeeded', prevState: m.status, newState: 'active', reason: null, result: 'ok' });
      return { applied: true, status: 'active', paymentId: rec.paymentId, allocated: alloc };
    }

    if (!success) {
      const step = dunningStep(attempt);
      const newStatus = transition.changed ? transition.status : m.status;
      const nextBilling = step.terminal === 'suspend' ? null : new Date(Date.now() + (step.retryInDays ?? 0) * DAY);
      await this.repo.applyDunning(membershipId, { status: newStatus, nextBillingAt: nextBilling, attempt });
      await this.repo.addActivity({ membershipId, tenantId: m.tenantId, branchId: m.branchId, customerId: m.customerId, planId: m.planId, activityType: 'payment_failed', customerName: m.customerName, planName: m.planName, amountCents: amount });
      await this.repo.addAudit({ membershipId, tenantId: m.tenantId, branchId: m.branchId, planId: m.planId, actorUserId: actor.userId, actorRole: actor.role, action: 'renewal_failed', prevState: m.status, newState: newStatus, reason: result.declineReason ?? 'declined', result: step.terminal === 'suspend' ? 'suspended' : 'retry_scheduled' });
      // Best-effort payment-failure notice (in-app). Comms must never affect the dunning result; it is idempotent per day.
      if (this.comms) { try { await this.comms.notifyPaymentFailed(actor === SYSTEM ? workerPrincipal('membership-billing', { tenantId: m.tenantId, branchId: m.branchId ?? null }) as any : { tenantId: m.tenantId, branchId: m.branchId ?? '', userId: actor.userId ?? 'system', role: actor.role ?? 'SYSTEM', permissions: [] }, membershipId); } catch { /* swallow: dunning already applied */ } }
      return { applied: true, status: newStatus, paymentId: rec.paymentId };
    }

    // success but transition was a no-op (e.g., already terminal) — payment recorded, no state change
    return { applied: true, status: m.status, paymentId: rec.paymentId, allocated: alloc };
  }

  /** Sweep memberships due for renewal and attempt each charge through the configured processor. With the default
   * (unconfigured) adapter, nothing is charged and nothing changes state — the summary reports them as not configured. */
  async runDueRenewals(now: Date = new Date(), limit = 100): Promise<{ due: number; succeeded: number; failed: number; notConfigured: number; results: Array<{ membershipId: string; outcome: string }> }> {
    const due = await this.repo.findDue(now, limit);
    let succeeded = 0, failed = 0, notConfigured = 0;
    const results: Array<{ membershipId: string; outcome: string }> = [];
    for (const m of due) {
      const dueDate = m.nextBillingAt ?? now;
      const idemKey = renewalIdempotencyKey(m.membershipId, dueDate.toISOString(), 1);
      const charge = await this.charger.charge({ tenantId: m.tenantId, amountCents: m.priceCents, currency: 'USD', customerId: m.customerId, membershipId: m.membershipId, idempotencyKey: idemKey, descriptor: m.planName ?? 'Membership' });
      if (charge.status === 'not_configured') { notConfigured++; results.push({ membershipId: m.membershipId, outcome: 'not_configured' }); continue; }
      const applied = await this.applyRenewalResult(m.membershipId, { status: charge.status, amountCents: m.priceCents, processor: charge.processor, processorRef: charge.processorRef ?? null, declineReason: charge.declineReason ?? null }, { attempt: 1 });
      if (charge.status === 'succeeded') succeeded++; else failed++;
      results.push({ membershipId: m.membershipId, outcome: applied.status ?? charge.status });
    }
    return { due: due.length, succeeded, failed, notConfigured, results };
  }

  /** Map a Fiserv CardPointe charge/refund response to a renewal result and apply it (idempotent on the retref-derived
   * key). Call after each real CardPointe charge against a member's saved profile. */
  async applyCardpointeRenewal(membershipId: string, charge: CardPointeRenewalResult, opts: { attempt?: number; actor?: SystemActor } = {}): Promise<ApplyResult> {
    const mapped = cardpointeRenewalToEvent(charge);
    if (!mapped.ok) return { applied: false, reason: mapped.reason };
    const amountCents = charge.amount ? Math.round(parseFloat(charge.amount) * 100) : undefined;
    return this.applyRenewalResult(membershipId, { status: mapped.event === 'renewal_succeeded' ? 'succeeded' : 'failed', amountCents, processor: 'cardpointe', processorRef: mapped.ref }, opts);
  }

  /** Preview proration for a mid-cycle plan change. Pure read + math; performs no charge. */
  async previewProration(membershipId: string, newPriceCents: number, changeAtISO?: string): Promise<(ProrationResult & { membershipId: string }) | null> {
    const m = await this.repo.getForBilling(membershipId);
    if (!m) return null;
    const start = m.currentPeriodStart ?? m.startedAt ?? new Date();
    const end = m.currentPeriodEnd ?? addInterval(start, m.billingInterval as BillingInterval, m.intervalCount);
    const changeAt = changeAtISO ? new Date(changeAtISO) : new Date();
    return { membershipId, ...prorate(m.priceCents, Math.max(0, Math.round(newPriceCents)), start, end, changeAt) };
  }
}

export type { BillingMembership };
