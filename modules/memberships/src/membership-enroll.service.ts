// membership-enroll.service.ts — enrollment + benefit reservation + redemption. Enrollment issues the cycle's credits
// into the append-only ledger and captures auto-renew consent (required for auto-renewing plans — negative-option
// compliance). Reservation/redemption are double-spend-safe: availability is derived from the ledger via creditBalance
// (open holds already net out), and a service line can redeem at most once (checked here + hardened by a unique index).
// The redemption row freezes a commission snapshot so payroll computes from the terms in force at redemption.
import { randomUUID } from 'crypto';
import { creditBalance, canReserveServiceCredit, benefitsActive, type LedgerEntry } from './memberships-core';
import { addInterval, type BillingInterval } from './membership-billing-core';
import { initialIssuedEntries, commissionSnapshot, memberNumber } from './membership-enroll-core';
import { resolveCancel, resolvePause, resolveResume, type LifecycleResult } from './membership-lifecycle-core';
import type { MembershipEnrollRepositoryPort, EnrollContext, LedgerEntryRow, LifecycleRow, AvailablePlanRow } from './membership-enroll.repository';
import type { MembershipCommsService } from './membership-comms.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(m = 'Forbidden') { super(m); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(m = 'Invalid request') { super(m); this.name = 'ValidationError'; } }
export class ConcurrencyError extends Error { constructor(m = 'Membership was modified; reload and retry') { super(m); this.name = 'ConcurrencyError'; } }

const DAY = 86400000;
const toEntry = (r: LedgerEntryRow): LedgerEntry => ({ entryType: r.entryType, quantity: r.quantity, amountCents: r.amountCents });

export interface EnrollRequest { customerId: string; planId: string; planVersionId?: string; assignedTechnicianId?: string | null; autoRenewConsent?: boolean; agreementVersion?: string | null; channel?: string }
export interface ReserveRequest { membershipId: string; benefitId: string; ticketId?: string | null; quantity?: number }
export interface RedeemRequest { membershipId: string; benefitId: string; ticketId?: string | null; serviceLineId?: string | null; technicianId?: string | null; reservationRef?: string | null; upgradeChargeCents?: number }

export interface MemberBenefitView { benefitId: string; label: string; benefitType: string; serviceId: string | null; serviceCreditsAvailable: number; dollarCreditsAvailableCents: number }
export interface MemberView {
  hasMembership: boolean;
  membership: { membershipId: string; planName: string | null; status: string; memberNumber: string | null; nextBillingAt: string | null; startedAt: string | null } | null;
  benefits: MemberBenefitView[];
  availablePlans?: AvailablePlanRow[];
}

export class MembershipEnrollService {
  constructor(private readonly repo: MembershipEnrollRepositoryPort, private readonly comms?: Pick<MembershipCommsService, 'sendWelcome'>) {}

  async enroll(ctx: EnrollContext, body: EnrollRequest) {
    const customerId = body?.customerId;
    if (!customerId) throw new ValidationError('customerId is required');
    if (!body?.planId) throw new ValidationError('planId is required');
    const customerName = await this.repo.getCustomerName(ctx, customerId);
    if (customerName == null) throw withCode(new ValidationError('Customer not found'), 'CUSTOMER_NOT_FOUND');
    const plan = await this.repo.getPlanForEnroll(ctx, body.planId, body.planVersionId);
    if (!plan) throw withCode(new ValidationError('Plan not found'), 'PLAN_NOT_FOUND');
    if (plan.status !== 'active' || !plan.planVersionId) throw withCode(new ValidationError('Plan has no active published version'), 'PLAN_NOT_PUBLISHED');
    if (plan.autoRenew && !body.autoRenewConsent) throw withCode(new ValidationError('Auto-renew consent is required to enroll in this plan'), 'AUTO_RENEW_CONSENT_REQUIRED');

    const now = new Date();
    const interval = plan.billingInterval as BillingInterval;
    const trialDays = Math.max(0, Math.floor(plan.trialDays || 0));
    const status = trialDays > 0 ? 'trial' : 'active';

    let periodEnd: Date | null;
    let nextBillingAt: Date | null;
    if (trialDays > 0) {
      periodEnd = new Date(now.getTime() + trialDays * DAY);
      nextBillingAt = plan.autoRenew ? periodEnd : null;
    } else {
      periodEnd = interval === 'none' || interval === 'custom' ? null : addInterval(now, interval, plan.intervalCount);
      nextBillingAt = plan.autoRenew && periodEnd ? periodEnd : null;
    }

    // random, never derived from the customer id (the same customer enrolled twice got the same number)
    const { membershipId, memberNumber: memberNum } = await this.repo.insertMembership(ctx, {
      customerId, planId: plan.planId, planVersionId: plan.planVersionId, status, assignedTechnicianId: body.assignedTechnicianId ?? null, memberNumber: memberNumber(),
      startedAt: now, currentPeriodStart: now, currentPeriodEnd: periodEnd, nextBillingAt, termEndAt: null,
      autoRenew: plan.autoRenew, autoRenewConsentAt: plan.autoRenew && body.autoRenewConsent ? now : null, agreementVersion: body.agreementVersion ?? null, enrolledChannel: body.channel ?? 'pos',
    });

    const entries = initialIssuedEntries(plan.benefits.map((b) => ({ benefitId: b.benefitId, benefitType: b.benefitType, serviceId: b.serviceId, creditsPerCycle: b.creditsPerCycle, valueCents: b.valueCents })));
    if (entries.length) await this.repo.issueInitialCredits(ctx, membershipId, entries, null);

    await this.repo.addActivity(ctx, { membershipId, customerId, planId: plan.planId, activityType: 'enrolled', customerName, planName: plan.planName, amountCents: null });
    await this.repo.addAudit(ctx, { membershipId, planId: plan.planId, planVersionId: plan.planVersionId, action: 'membership_enrolled', prevState: null, newState: status, reason: null, result: 'ok' });
    // Best-effort welcome message (in-app). Comms must never fail an enrollment, and it is idempotent on the membership.
    if (this.comms) { try { await this.comms.sendWelcome(ctx, membershipId); } catch { /* swallow: enrollment already succeeded */ } }
    return { membershipId, memberNumber: memberNum, status, creditsIssued: entries.length };
  }

  async listCustomerMemberships(ctx: EnrollContext, customerId: string) {
    if (!customerId) throw new ValidationError('customerId is required');
    return { customerId, memberships: await this.repo.listCustomerMemberships(ctx, customerId) };
  }

  // Batch member-status lookup for list surfaces (check-in, queue, customer lists). One query for the whole page —
  // returns only the customers who ARE active members; a customerId absent from the result is a non-member.
  async membershipsByCustomers(ctx: EnrollContext, customerIds: string[]) {
    const ids = [...new Set((customerIds || []).filter(Boolean))].slice(0, 500);
    if (!ids.length) return { members: [] as Array<{ customerId: string; isMember: boolean; planName: string | null; status: string }> };
    const rows = await this.repo.activeMembershipsForCustomers(ctx, ids);
    return { members: rows.map((r) => ({ customerId: r.customerId, isMember: true, planName: r.planName, status: r.status })) };
  }

  // ---- lifecycle: cancel / pause / resume (status + auto_renew only; no charge, no refund) ----
  private async runLifecycle(ctx: EnrollContext, membershipId: string, expectedVersion: number | undefined, resolve: (m: LifecycleRow) => LifecycleResult) {
    if (!membershipId) throw new ValidationError('membershipId is required');
    const m = await this.repo.loadForLifecycle(ctx, membershipId);
    if (!m) throw withCode(new ValidationError('Membership not found'), 'MEMBERSHIP_NOT_FOUND');
    const res = resolve(m);
    if (!res.ok) throw new ValidationError(res.reason);
    const applied = await this.repo.applyLifecycle(ctx, membershipId, res.patch, expectedVersion ?? m.version);
    if (applied.conflict) throw new ConcurrencyError();
    await this.repo.addActivity(ctx, { membershipId, customerId: m.customerId, planId: m.planId, activityType: res.activityType, customerName: m.customerName, planName: m.planName, amountCents: null });
    await this.repo.addAudit(ctx, { membershipId, planId: m.planId, planVersionId: m.planVersionId, action: res.activityType, prevState: m.status, newState: res.targetStatus, reason: res.patch.cancelReason ?? null, result: 'ok' });
    return { membershipId, status: res.targetStatus, cancelAtPeriodEnd: res.patch.cancelAtPeriodEnd ?? false };
  }

  async cancelMembership(ctx: EnrollContext, membershipId: string, opts: { atPeriodEnd?: boolean; reason?: string | null; expectedVersion?: number } = {}) {
    return this.runLifecycle(ctx, membershipId, opts.expectedVersion, (m) => resolveCancel(m.status, { atPeriodEnd: opts.atPeriodEnd ?? true, currentPeriodEnd: m.currentPeriodEnd, reason: opts.reason ?? null, nowIso: new Date().toISOString() }));
  }

  async pauseMembership(ctx: EnrollContext, membershipId: string, opts: { resumesAt?: string | null; expectedVersion?: number } = {}) {
    return this.runLifecycle(ctx, membershipId, opts.expectedVersion, (m) => resolvePause(m.status, { resumesAt: opts.resumesAt ?? null, nowIso: new Date().toISOString() }));
  }

  async resumeMembership(ctx: EnrollContext, membershipId: string, opts: { expectedVersion?: number } = {}) {
    return this.runLifecycle(ctx, membershipId, opts.expectedVersion, (_m) => resolveResume(_m.status));
  }

  /** Member-facing view of a customer's membership (plan/status/member#/next billing + benefits with remaining credits).
   * Shared by the customer app (own membership) and the tech app (the ticket customer's membership). */
  async membershipView(ctx: EnrollContext, customerId: string): Promise<MemberView> {
    const availablePlans = await this.repo.getAvailablePlansForMember(ctx).catch(() => []);
    if (!customerId) return { hasMembership: false, membership: null, benefits: [], availablePlans };
    const { memberships } = await this.listCustomerMemberships(ctx, customerId);
    const active = memberships.find((m) => benefitsActive(m.status)) || memberships[0] || null;
    if (!active) return { hasMembership: false, membership: null, benefits: [], availablePlans };
    const ben = await this.getMembershipBenefits(ctx, active.membershipId);
    return {
      hasMembership: true,
      membership: { membershipId: active.membershipId, planName: active.planName, status: active.status, memberNumber: active.memberNumber, nextBillingAt: active.nextBillingAt, startedAt: active.startedAt },
      benefits: ben.benefits,
      availablePlans,
    };
  }

  /** Member view resolved from a ticket (the ticket's customer). Tenant-scoped; returns empty when the ticket has no
   * resolvable customer. */
  async membershipForTicket(ctx: EnrollContext, ticketId: string): Promise<MemberView> {
    if (!ticketId) return { hasMembership: false, membership: null, benefits: [] };
    const customerId = await this.repo.ticketCustomerId(ctx, ticketId);
    if (!customerId) return { hasMembership: false, membership: null, benefits: [] };
    return this.membershipView(ctx, customerId);
  }

  /** Membership coverage for a ticket at checkout: the services already redeemed against this ticket (covered, not to be
   * re-charged), any upgrade charges, and the member's available discounts / dollar credits. Pure composition of existing
   * data — it does NOT compute the checkout total. The checkout applies the covered amount through its own discount path,
   * keeping the checkout service the single source of truth for money. */
  async coverage(ctx: EnrollContext, ticketId: string) {
    if (!ticketId) throw new ValidationError('ticketId is required');
    const empty = { ticketId, membership: null as { membershipId: string; planName: string | null; status: string } | null, coveredLines: [] as Array<{ serviceLineId: string | null; serviceName: string | null; coveredCents: number }>, coveredTotalCents: 0, upgradeChargeCents: 0, memberDiscounts: [] as Array<{ benefitId: string; label: string; kind: string }>, dollarCreditAvailableCents: 0 };
    const customerId = await this.repo.ticketCustomerId(ctx, ticketId);
    if (!customerId) return empty;

    const reds = await this.repo.redemptionsForTicket(ctx, ticketId);
    const coveredLines = reds.map((r) => ({ serviceLineId: r.serviceLineId, serviceName: r.serviceName, coveredCents: r.standardValueCents }));
    const coveredTotalCents = coveredLines.reduce((a, l) => a + l.coveredCents, 0);
    const upgradeChargeCents = reds.reduce((a, r) => a + r.upgradeChargeCents, 0);

    const memberships = await this.repo.listCustomerMemberships(ctx, customerId);
    const active = memberships.find((m) => benefitsActive(m.status)) || null;
    if (!active) return { ...empty, coveredLines, coveredTotalCents, upgradeChargeCents };

    const ben = await this.getMembershipBenefits(ctx, active.membershipId);
    const memberDiscounts = ben.benefits.filter((b) => b.benefitType === 'percent_discount' || b.benefitType === 'fixed_discount').map((b) => ({ benefitId: b.benefitId, label: b.label, kind: b.benefitType === 'percent_discount' ? 'percent' : 'fixed' }));
    const dollarCreditAvailableCents = ben.benefits.reduce((a, b) => a + (b.dollarCreditsAvailableCents || 0), 0);

    return { ticketId, membership: { membershipId: active.membershipId, planName: active.planName, status: active.status }, coveredLines, coveredTotalCents, upgradeChargeCents, memberDiscounts, dollarCreditAvailableCents };
  }

  async getMembershipBenefits(ctx: EnrollContext, membershipId: string) {
    const m = await this.repo.getMembershipLite(ctx, membershipId);
    if (!m) throw withCode(new ValidationError('Membership not found'), 'MEMBERSHIP_NOT_FOUND');
    const meta = m.planVersionId ? await this.repo.benefitsMeta(ctx, m.planVersionId) : [];
    const rows = await this.repo.ledgerForMembership(ctx, membershipId);
    const byBenefit = new Map<string, LedgerEntry[]>();
    for (const r of rows) { const k = r.benefitId || '_'; const arr = byBenefit.get(k) ?? []; arr.push(toEntry(r)); byBenefit.set(k, arr); }
    const benefits = meta.map((mb) => {
      const b = creditBalance(byBenefit.get(mb.benefitId) ?? []);
      return { benefitId: mb.benefitId, label: mb.label, benefitType: mb.benefitType, serviceId: mb.serviceId, serviceCreditsAvailable: b.serviceCreditsAvailable, dollarCreditsAvailableCents: b.dollarCreditsAvailableCents };
    });
    return { membershipId, status: m.status, active: benefitsActive(m.status), benefits };
  }

  async reserveBenefit(ctx: EnrollContext, body: ReserveRequest) {
    const m = await this.repo.getMembershipLite(ctx, body.membershipId);
    if (!m) throw withCode(new ValidationError('Membership not found'), 'MEMBERSHIP_NOT_FOUND');
    if (!benefitsActive(m.status)) throw withCode(new ValidationError('Membership is not active'), 'MEMBERSHIP_NOT_ACTIVE');
    if (!m.planVersionId) throw withCode(new ValidationError('Membership has no plan version'), 'MEMBERSHIP_NO_PLAN_VERSION');
    const benefit = await this.repo.getBenefit(ctx, m.planVersionId, body.benefitId);
    if (!benefit) throw withCode(new ValidationError('Benefit not found'), 'BENEFIT_NOT_FOUND');
    const qty = Math.max(1, Math.floor(body.quantity || 1));
    const entries = (await this.repo.ledgerForBenefit(ctx, body.membershipId, body.benefitId)).map(toEntry);
    if (!canReserveServiceCredit(entries, qty)) throw withCode(new ValidationError('Insufficient membership credits'), 'MEMBERSHIP_CREDITS_INSUFFICIENT');
    const reservationRef = randomUUID();
    await this.repo.appendLedger(ctx, { membershipId: body.membershipId, benefitId: body.benefitId, entryType: 'reserved', quantity: qty, amountCents: 0, serviceId: benefit.serviceId, ticketId: body.ticketId ?? null, reservationRef, reason: 'booking_reserve' });
    await this.repo.addAudit(ctx, { membershipId: body.membershipId, planId: m.planId, planVersionId: m.planVersionId, action: 'benefit_reserved', prevState: null, newState: null, reason: body.benefitId, result: 'ok' });
    return { reservationRef };
  }

  async releaseBenefit(ctx: EnrollContext, reservationRef: string) {
    if (!reservationRef) throw new ValidationError('reservationRef is required');
    const res = await this.repo.findOpenReservation(ctx, reservationRef);
    if (!res) throw withCode(new ValidationError('Reservation not found'), 'RESERVATION_NOT_FOUND');
    if (res.closed) return { released: false, reason: 'already_closed' };
    await this.repo.appendLedger(ctx, { membershipId: res.membershipId, benefitId: res.benefitId, entryType: 'released', quantity: res.quantity, amountCents: res.amountCents, serviceId: res.serviceId, ticketId: null, reservationRef, reason: 'booking_release' });
    await this.repo.addAudit(ctx, { membershipId: res.membershipId, planId: null, planVersionId: null, action: 'benefit_released', prevState: null, newState: null, reason: reservationRef, result: 'ok' });
    return { released: true };
  }

  async redeemBenefit(ctx: EnrollContext, body: RedeemRequest) {
    const m = await this.repo.getMembershipLite(ctx, body.membershipId);
    if (!m) throw withCode(new ValidationError('Membership not found'), 'MEMBERSHIP_NOT_FOUND');
    if (!benefitsActive(m.status)) throw withCode(new ValidationError('Membership is not active'), 'MEMBERSHIP_NOT_ACTIVE');
    if (!m.planVersionId) throw withCode(new ValidationError('Membership has no plan version'), 'MEMBERSHIP_NO_PLAN_VERSION');
    const benefit = await this.repo.getBenefit(ctx, m.planVersionId, body.benefitId);
    if (!benefit) throw withCode(new ValidationError('Benefit not found'), 'BENEFIT_NOT_FOUND');

    if (body.serviceLineId && (await this.repo.redemptionExistsForLine(ctx, body.serviceLineId))) {
      throw withCode(new ValidationError('This service line has already redeemed a membership benefit'), 'BENEFIT_ALREADY_REDEEMED');
    }

    if (body.reservationRef) {
      const res = await this.repo.findOpenReservation(ctx, body.reservationRef);
      if (!res) throw withCode(new ValidationError('Reservation not found'), 'RESERVATION_NOT_FOUND');
      if (res.closed) throw withCode(new ValidationError('Reservation already closed'), 'RESERVATION_CLOSED');
    } else {
      const entries = (await this.repo.ledgerForBenefit(ctx, body.membershipId, body.benefitId)).map(toEntry);
      if (!canReserveServiceCredit(entries, 1)) throw withCode(new ValidationError('Insufficient membership credits'), 'MEMBERSHIP_CREDITS_INSUFFICIENT');
    }

    const lineSnap = body.serviceLineId ? await this.repo.serviceLineSnapshot(ctx, body.serviceLineId) : null;
    const standardValueCents = lineSnap?.priceCents ?? benefit.allocatedValueCents ?? 0;
    const allocatedValueCents = benefit.allocatedValueCents || benefit.valueCents || 0;
    const snap = commissionSnapshot(m.techCommissionBasis, m.techSplitPct, standardValueCents, allocatedValueCents, 0);

    const { redemptionId } = await this.repo.insertRedemption(ctx, {
      membershipId: body.membershipId, ticketId: body.ticketId ?? null, serviceLineId: body.serviceLineId ?? null, benefitId: body.benefitId,
      serviceId: benefit.serviceId ?? lineSnap?.serviceId ?? null, standardValueCents, allocatedValueCents, upgradeChargeCents: Math.max(0, Math.floor(body.upgradeChargeCents || 0)),
      technicianId: body.technicianId ?? null, commissionBasisSnapshot: JSON.stringify(snap),
    });

    const isDollar = benefit.benefitType === 'dollar_credit';
    await this.repo.appendLedger(ctx, { membershipId: body.membershipId, benefitId: body.benefitId, entryType: 'redeemed', quantity: isDollar ? 0 : 1, amountCents: isDollar ? allocatedValueCents : 0, serviceId: benefit.serviceId, ticketId: body.ticketId ?? null, reservationRef: body.reservationRef ?? null, reason: 'service_redeem' });
    await this.repo.addActivity(ctx, { membershipId: body.membershipId, customerId: m.customerId, planId: m.planId, activityType: 'redeemed', customerName: null, planName: null, amountCents: standardValueCents });
    await this.repo.addAudit(ctx, { membershipId: body.membershipId, planId: m.planId, planVersionId: m.planVersionId, action: 'benefit_redeemed', prevState: null, newState: null, reason: body.benefitId, result: 'ok' });
    return { redemptionId, standardValueCents, allocatedValueCents, allocation: { techCents: snap.techCents, ownerCents: snap.ownerCents } };
  }
}
