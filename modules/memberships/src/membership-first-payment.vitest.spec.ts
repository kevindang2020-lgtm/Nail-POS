// membership-first-payment.vitest.spec.ts — D6 Membership guide §16 (Nov 4 2026): a priced plan without a trial starts
// PENDING and is activated only by a CONFIRMED first payment (saved card through the gateway, or a paid invoice).
import { describe, it, expect, beforeEach } from 'vitest';
import { MembershipBillingService, type MembershipChargePort } from './membership-billing.service';
import { InMemoryMembershipBillingRepository, type BillingMembership } from './membership-billing.repository';
import { MembershipEnrollService } from './membership-enroll.service';
import { InMemoryMembershipEnrollRepository, type PlanForEnroll } from './membership-enroll.repository';

const base: BillingMembership = {
  membershipId: 'm1', tenantId: 't1', branchId: 'b1', customerId: 'c1', customerName: 'Jess', planId: 'p1', planName: 'VIP', planVersionId: 'v1',
  status: 'pending', priceCents: 6000, billingInterval: 'month', intervalCount: 1, techSplitPct: 60, allocationTiming: 'on_redemption',
  currentPeriodStart: null, currentPeriodEnd: null, nextBillingAt: null, startedAt: new Date(), cyclesBilled: 0, autoRenew: true,
};
const ctx = { tenantId: 't1', userId: 'u1', role: 'MANAGER' };
const card = (status: 'succeeded' | 'failed'): MembershipChargePort & { calls: any[] } => {
  const calls: any[] = [];
  return { calls, async charge(req) { calls.push(req); return status === 'succeeded' ? { status, processor: 'cardpointe', processorRef: 'RET1' } : { status, processor: 'cardpointe', processorRef: null, declineReason: 'Insufficient funds' }; } };
};
let repo: InMemoryMembershipBillingRepository;
beforeEach(() => { repo = new InMemoryMembershipBillingRepository(); repo.seed({ ...base }); repo.firstPaymentCents = 7500; });

describe('enrollment of a priced plan without a trial', () => {
  it('starts pending with no credits and no billing date, and says what is due (price + enrollment fee)', async () => {
    const er = new InMemoryMembershipEnrollRepository(); const svc = new MembershipEnrollService(er);
    er.seedCustomer('c1', 'Jess');
    const plan: PlanForEnroll = { planId: 'p1', planName: 'VIP', planVersionId: 'v1', status: 'active', billingInterval: 'month', intervalCount: 1, autoRenew: true, trialDays: 0,
      techCommissionBasis: 'allocated', techSplitPct: 60, allocationTiming: 'on_redemption', techFixedCents: 0, priceCents: 6000, enrollmentFeeCents: 1500,
      benefits: [{ benefitId: 'b1', benefitType: 'service_credit', serviceId: 's1', label: 'Gel', creditsPerCycle: 1, valueCents: 0, allocatedValueCents: 4500, percent: 0 }] };
    er.seedPlan(plan);
    const e = await svc.enroll({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] } as any, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    expect(e).toMatchObject({ status: 'pending', creditsIssued: 0, firstPaymentDueCents: 7500 });
    const ben = await svc.getMembershipBenefits({ tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: [] } as any, e.membershipId);
    expect(ben.active).toBe(false); expect(ben.benefits[0].serviceCreditsAvailable).toBe(0);
  });
});

describe('collecting the first payment', () => {
  it('card on file: charged once as customer-initiated, then active with its first period; a retry is a duplicate, not a second charge', async () => {
    const ch = card('succeeded'); const svc = new MembershipBillingService(repo, ch);
    const r = await svc.collectFirstPayment(ctx, 'm1', { method: 'card_on_file' });
    expect(r).toMatchObject({ status: 'active', amountCents: 7500, duplicate: false });
    expect(ch.calls).toHaveLength(1); expect(ch.calls[0]).toMatchObject({ amountCents: 7500, initiator: 'customer', idempotencyKey: 'membership-first:m1:a1' });
    const m = repo.snapshot('m1')!; expect(m.status).toBe('active'); expect(m.currentPeriodEnd).not.toBeNull(); expect(m.nextBillingAt).not.toBeNull();
    expect(repo.payments[0]).toMatchObject({ kind: 'enrollment', status: 'succeeded', processorRef: 'RET1' });
    expect(repo.cycleCredits.has('m1|first')).toBe(true);
    await expect(svc.collectFirstPayment(ctx, 'm1', { method: 'card_on_file' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_NOT_AWAITING_PAYMENT' });
    expect(ch.calls).toHaveLength(1);
  });
  it('a declined card keeps it pending (audited); with no card billing configured it says so', async () => {
    await expect(new MembershipBillingService(repo, card('failed')).collectFirstPayment(ctx, 'm1', { method: 'card_on_file' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_FIRST_PAYMENT_DECLINED' });
    expect(repo.snapshot('m1')!.status).toBe('pending'); expect(repo.audits.at(-1)).toMatchObject({ action: 'first_payment_declined' });
    // the next try is a new processor attempt (a decline is never replayed), and its success activates the membership
    const ok = card('succeeded'); expect((await new MembershipBillingService(repo, ok).collectFirstPayment(ctx, 'm1', { method: 'card_on_file' })).status).toBe('active');
    expect(ok.calls[0].idempotencyKey).toBe('membership-first:m1:a2');
    repo.seed({ ...base, membershipId: 'm3' });
    await expect(new MembershipBillingService(repo).collectFirstPayment(ctx, 'm3', { method: 'card_on_file' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_CARD_BILLING_NOT_CONFIGURED' });
  });
  it('invoice: only a PAID invoice of this customer, at least the amount, never used twice', async () => {
    repo.invoices.push({ id: 'i-small', tenantId: 't1', customerId: 'c1', number: 'INV-1', totalCents: 5000, paid: true },
      { id: 'i-other', tenantId: 't1', customerId: 'c9', number: 'INV-2', totalCents: 9000, paid: true },
      { id: 'i-ok', tenantId: 't1', customerId: 'c1', number: 'INV-3', totalCents: 7500, paid: true });
    const svc = new MembershipBillingService(repo);
    expect((await svc.firstPaymentState(ctx, 'm1')).invoices.map((i) => i.id)).toEqual(['i-ok']);
    await expect(svc.collectFirstPayment(ctx, 'm1', { method: 'invoice', invoiceId: 'i-small' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE' });
    await expect(svc.collectFirstPayment(ctx, 'm1', { method: 'invoice', invoiceId: 'i-other' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE' });
    expect((await svc.collectFirstPayment(ctx, 'm1', { method: 'invoice', invoiceId: 'i-ok' })).status).toBe('active');
    repo.seed({ ...base, membershipId: 'm2' });
    await expect(svc.collectFirstPayment(ctx, 'm2', { method: 'invoice', invoiceId: 'i-ok' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_INVOICE_NOT_ELIGIBLE' });
  });
  it('another salon\'s membership is not found', async () => {
    await expect(new MembershipBillingService(repo).collectFirstPayment({ ...ctx, tenantId: 't2' }, 'm1', { method: 'card_on_file' })).rejects.toMatchObject({ apiCode: 'MEMBERSHIP_NOT_FOUND' });
  });
});
