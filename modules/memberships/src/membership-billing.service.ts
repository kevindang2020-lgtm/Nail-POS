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
export interface MembershipChargeRequest { tenantId: string; amountCents: number; currency?: string; customerId: string; membershipId: string; idempotencyKey: string; descriptor?: string; /** 'customer' = the member is present (first payment); default merchant-initiated renewal */ initiator?: 'customer' | 'merchant' }
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
    // the cycle is anchored on its ORIGINAL due date (the current period's end) — a retry moves next_billing_at, and anchoring on
    // it shifted the paid period to the retry date and minted a fresh key for every sweep
    const dueDate = m.currentPeriodEnd ?? m.nextBillingAt ?? new Date();
    const idemKey = renewalIdempotencyKey(membershipId, dueDate.toISOString(), attempt);
    const success = result.status === 'succeeded';
    const alloc = success ? renewalAllocation(amount, m.techSplitPct, m.allocationTiming) : { techCents: 0, ownerCents: 0 };

    const periodStart = success ? (m.currentPeriodEnd ?? m.nextBillingAt ?? new Date()) : (m.currentPeriodStart ?? null);
    const periodEnd = success ? addInterval(periodStart as Date, m.billingInterval as BillingInterval, m.intervalCount, m.startedAt ? m.startedAt.getUTCDate() : null) : (m.currentPeriodEnd ?? null);

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
      // the new cycle's credits (renewal never issued any: a member paid every month and kept only the first month's credits)
      if (m.planVersionId && this.repo.issueCycleCredits) await this.repo.issueCycleCredits(m.tenantId, membershipId, m.planVersionId, newStart.toISOString());
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

  /** D6 Membership §16 (Nov 4 2026): what a PENDING membership still owes and how it can be paid. */
  async firstPaymentState(ctx: FirstPaymentCtx, membershipId: string) {
    const m = await this.repo.getForBilling(membershipId);
    if (!m || m.tenantId !== ctx.tenantId) throw new FirstPaymentError('That membership could not be found.', 'MEMBERSHIP_NOT_FOUND', 404);
    const amount = this.repo.firstPaymentAmount ? await this.repo.firstPaymentAmount(m.tenantId, membershipId) : m.priceCents;
    const pending = m.status === 'pending';
    return { membershipId, status: m.status, awaitingFirstPayment: pending, amountDueCents: pending ? amount : 0,
      cardOnFile: pending && this.repo.hasSavedCard ? await this.repo.hasSavedCard(m.tenantId, m.customerId) : false,
      cardBillingConfigured: !(this.charger instanceof UnconfiguredMembershipChargeAdapter),
      invoices: pending && this.repo.eligibleInvoices ? (await this.repo.eligibleInvoices(m.tenantId, m.customerId)).filter((i) => i.totalCents >= amount) : [] };
  }

  /** Collect the first payment of a PENDING membership and activate it — only on a confirmed payment:
   *   card_on_file  the member's saved card through the salon's gateway (customer-initiated); a decline keeps it pending
   *   invoice       a PAID invoice of this salon for this customer, at least the amount, not used by another membership
   *  The payment row, pending → active, the first period, the first credits, activity and audit commit together;
   *  idempotent per membership (a retry or double tap never charges or activates twice). */
  async collectFirstPayment(ctx: FirstPaymentCtx, membershipId: string, b: { method?: unknown; invoiceId?: unknown }) {
    const m = await this.repo.getForBilling(membershipId);
    if (!m || m.tenantId !== ctx.tenantId) throw new FirstPaymentError('That membership could not be found.', 'MEMBERSHIP_NOT_FOUND', 404);
    if (m.status !== 'pending') throw new FirstPaymentError('This membership is not waiting for a first payment.', 'MEMBERSHIP_NOT_AWAITING_PAYMENT', 409, { status: m.status });
    if (!this.repo.applyFirstPayment) throw new FirstPaymentError('First payments cannot be recorded here.', 'MEMBERSHIP_NOT_AWAITING_PAYMENT', 409);
    const amount = this.repo.firstPaymentAmount ? await this.repo.firstPaymentAmount(m.tenantId, membershipId) : m.priceCents;
    const method = b?.method === 'card_on_file' ? 'card_on_file' : b?.method === 'invoice' ? 'invoice' : null;
    if (!method) throw new FirstPaymentError('Choose how the first payment is collected.', 'MEMBERSHIP_PAYMENT_METHOD_REQUIRED', 400);
    const key = `membership-first:${membershipId}`;
    let processor: string, processorRef: string | null;
    if (method === 'invoice') {
      const id = String(b?.invoiceId ?? '');
      const inv = this.repo.paidInvoiceFor ? await this.repo.paidInvoiceFor(m.tenantId, m.customerId, id) : null;
      if (!inv) throw new FirstPaymentError('Choose a paid invoice of this customer.', 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE', 409);
      if (inv.used) throw new FirstPaymentError('That invoice already paid for a membership.', 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE', 409);
      if (inv.totalCents < amount) throw new FirstPaymentError('That invoice is less than the first payment.', 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE', 409, { amountDueCents: amount, invoiceCents: inv.totalCents });
      processor = 'invoice'; processorRef = inv.id;
    } else {
      // each attempt has its own processor key (a decline is not replayed to the next try); two staff at once share it
      const attempt = (this.repo.firstPaymentFailures ? await this.repo.firstPaymentFailures(m.tenantId, membershipId) : 0) + 1;
      const chargeKey = `${key}:a${attempt}`;
      const r = await this.charger.charge({ tenantId: m.tenantId, amountCents: amount, customerId: m.customerId, membershipId, idempotencyKey: chargeKey, descriptor: 'membership-first-payment', initiator: 'customer' });
      if (r.status === 'not_configured') throw new FirstPaymentError('Card-on-file billing is not set up for this salon.', 'MEMBERSHIP_CARD_BILLING_NOT_CONFIGURED', 409, { reason: r.declineReason ?? null });
      if (r.status !== 'succeeded') {
        await this.repo.recordPayment({ membershipId, tenantId: m.tenantId, branchId: m.branchId, customerId: m.customerId, kind: 'enrollment', amountCents: amount, taxCents: 0, status: 'failed',
          processor: r.processor, processorRef: r.processorRef ?? null, idempotencyKey: chargeKey, attemptNumber: attempt, failureReason: r.declineReason ?? 'declined', periodStart: null, periodEnd: null, techAllocCents: 0, ownerAllocCents: 0, settled: false });
        await this.repo.addAudit({ membershipId, tenantId: m.tenantId, branchId: m.branchId, planId: m.planId, actorUserId: ctx.userId, actorRole: ctx.role, action: 'first_payment_declined', prevState: 'pending', newState: 'pending', reason: r.declineReason ?? 'declined', result: 'declined' });
        throw new FirstPaymentError('The card was declined. The membership stays pending.', 'MEMBERSHIP_FIRST_PAYMENT_DECLINED', 402, { reason: r.declineReason ?? null });
      }
      processor = r.processor; processorRef = r.processorRef ?? null;
    }
    const start = new Date();
    const end = m.billingInterval === 'none' || m.billingInterval === 'custom' ? null : addInterval(start, m.billingInterval as BillingInterval, m.intervalCount, start.getUTCDate());
    const next = m.autoRenew && end ? end : null;
    const out = await this.repo.applyFirstPayment({ membership: m, actorUserId: ctx.userId, actorRole: ctx.role, amountCents: amount, processor, processorRef, idempotencyKey: key, periodStart: start, periodEnd: end, nextBillingAt: next, method });
    if (!out.applied && !out.duplicate) throw new FirstPaymentError('This membership is not waiting for a first payment.', 'MEMBERSHIP_NOT_AWAITING_PAYMENT', 409);
    return { membershipId, status: 'active' as const, paymentId: out.paymentId, duplicate: out.duplicate, amountCents: amount, method: method as 'card_on_file' | 'invoice', currentPeriodEnd: end ? end.toISOString() : null };
  }

  /** Sweep memberships due for renewal and attempt each charge through the configured processor. With the default
   * (unconfigured) adapter, nothing is charged and nothing changes state — the summary reports them as not configured. */
  async runDueRenewals(now: Date = new Date(), limit = 100): Promise<{ due: number; succeeded: number; failed: number; notConfigured: number; results: Array<{ membershipId: string; outcome: string }> }> {
    const due = await this.repo.findDue(now, limit);
    let succeeded = 0, failed = 0, notConfigured = 0;
    const results: Array<{ membershipId: string; outcome: string }> = [];
    for (const m of due) {
      try {
        // the dunning attempt of THIS cycle (it was always 1, so a declined card was retried forever and never suspended),
        // anchored on the cycle's original due date
        const attempt = 1 + (this.repo.failedRenewalAttempts ? await this.repo.failedRenewalAttempts(m.tenantId, m.membershipId, m.currentPeriodStart ?? null) : 0);
        const anchor = m.currentPeriodEnd ?? m.nextBillingAt ?? now;
        const idemKey = renewalIdempotencyKey(m.membershipId, anchor.toISOString(), attempt);
        // a charge already recorded under this key is never sent to the card again (a crash after charging used to re-charge
        // on the next hourly sweep)
        if (this.repo.paymentByKey && await this.repo.paymentByKey(m.tenantId, m.membershipId, idemKey)) { results.push({ membershipId: m.membershipId, outcome: 'already_recorded' }); continue; }
        const charge = await this.charger.charge({ tenantId: m.tenantId, amountCents: m.priceCents, currency: 'USD', customerId: m.customerId, membershipId: m.membershipId, idempotencyKey: idemKey, descriptor: m.planName ?? 'Membership' });
        if (charge.status === 'not_configured') { notConfigured++; results.push({ membershipId: m.membershipId, outcome: 'not_configured' }); continue; }
        const applied = await this.applyRenewalResult(m.membershipId, { status: charge.status, amountCents: m.priceCents, processor: charge.processor, processorRef: charge.processorRef ?? null, declineReason: charge.declineReason ?? null }, { attempt });
        if (charge.status === 'succeeded') succeeded++; else failed++;
        results.push({ membershipId: m.membershipId, outcome: applied.status ?? charge.status });
      } catch (e) {
        // one membership's failure no longer stops the sweep for every member after it
        failed++; results.push({ membershipId: m.membershipId, outcome: `error:${String((e as { code?: string })?.code ?? (e as Error)?.message ?? 'unknown').slice(0, 60)}` });
      }
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
    const end = m.currentPeriodEnd ?? addInterval(start, m.billingInterval as BillingInterval, m.intervalCount, m.startedAt ? m.startedAt.getUTCDate() : null);
    const changeAt = changeAtISO ? new Date(changeAtISO) : new Date();
    return { membershipId, ...prorate(m.priceCents, Math.max(0, Math.round(newPriceCents)), start, end, changeAt) };
  }
}

export type { BillingMembership };

/** A coded refusal of the first-payment flow (the POS shows the message; the code is in the error registry). */
export class FirstPaymentError extends Error {
  constructor(message: string, readonly apiCode: string, readonly status = 409, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'FirstPaymentError'; }
}
export interface FirstPaymentCtx { tenantId: string; userId: string | null; role: string | null }

