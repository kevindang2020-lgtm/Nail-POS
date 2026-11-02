// membership-enroll.service.vitest.spec.ts — DB-free enrollment/redemption tests over the in-memory repository. Covers
// enrollment issuing the cycle's credits + the auto-renew consent gate, reservation holding credits (and over-reserve
// being impossible), redemption recording the immutable row + allocation snapshot, double-redemption of the same line
// being rejected, and release restoring availability.
import { describe, it, expect, beforeEach } from 'vitest';
import { MembershipEnrollService, ValidationError, ConcurrencyError } from './membership-enroll.service';
import { InMemoryMembershipEnrollRepository, type EnrollContext, type PlanForEnroll } from './membership-enroll.repository';

const ctx: EnrollContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['customers.view', 'customers.edit'] };
const plan: PlanForEnroll = {
  planId: 'p1', planName: 'VIP Nail Club', planVersionId: 'v1', status: 'active',
  billingInterval: 'month', intervalCount: 1, autoRenew: true, trialDays: 0,
  techCommissionBasis: 'allocated', techSplitPct: 60, allocationTiming: 'on_redemption', techFixedCents: 0,
  benefits: [
    { benefitId: 'b1', benefitType: 'service_credit', serviceId: 's1', label: 'Gel manicure', creditsPerCycle: 1, valueCents: 0, allocatedValueCents: 4500, percent: 0 },
    { benefitId: 'b2', benefitType: 'percent_discount', serviceId: null, label: '15% off retail', creditsPerCycle: 0, valueCents: 0, allocatedValueCents: 0, percent: 15 },
  ],
};

let repo: InMemoryMembershipEnrollRepository;
let svc: MembershipEnrollService;
beforeEach(() => {
  repo = new InMemoryMembershipEnrollRepository();
  svc = new MembershipEnrollService(repo);
  repo.seedCustomer('c1', 'Jess');
  repo.seedPlan(plan);
  repo.seedServiceLine('sl1', { serviceId: 's1', priceCents: 6000 });
});

describe('enrollment', () => {
  it('issues the crediting benefits and activates the membership', async () => {
    const e = await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    expect(e.status).toBe('active');
    expect(e.creditsIssued).toBe(1); // only the service_credit benefit; the percent discount issues nothing
    const ben = await svc.getMembershipBenefits(ctx, e.membershipId);
    expect(ben.benefits.find((b) => b.benefitId === 'b1')!.serviceCreditsAvailable).toBe(1);
  });

  it('requires auto-renew consent for an auto-renewing plan', async () => {
    await expect(svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: false })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown customer or plan', async () => {
    await expect(svc.enroll(ctx, { customerId: 'nope', planId: 'p1', autoRenewConsent: true })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.enroll(ctx, { customerId: 'c1', planId: 'nope', autoRenewConsent: true })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('reservation', () => {
  it('holds a credit and makes over-reservation impossible', async () => {
    const e = await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    const r = await svc.reserveBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1', ticketId: 'tk1' });
    expect(r.reservationRef).toBeTruthy();
    const ben = await svc.getMembershipBenefits(ctx, e.membershipId);
    expect(ben.benefits.find((b) => b.benefitId === 'b1')!.serviceCreditsAvailable).toBe(0);
    await expect(svc.reserveBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('release restores availability', async () => {
    const e = await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    const r = await svc.reserveBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1' });
    const rel = await svc.releaseBenefit(ctx, r.reservationRef);
    expect(rel.released).toBe(true);
    const ben = await svc.getMembershipBenefits(ctx, e.membershipId);
    expect(ben.benefits.find((b) => b.benefitId === 'b1')!.serviceCreditsAvailable).toBe(1);
  });
});

describe('redemption', () => {
  it('records an immutable redemption with the allocation snapshot and consumes the hold', async () => {
    const e = await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    const r = await svc.reserveBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1', ticketId: 'tk1' });
    const red = await svc.redeemBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1', ticketId: 'tk1', serviceLineId: 'sl1', technicianId: 't1', reservationRef: r.reservationRef });
    expect(red.standardValueCents).toBe(6000);   // menu price from the line snapshot
    expect(red.allocatedValueCents).toBe(4500);  // membership-allocated value
    expect(red.allocation).toEqual({ techCents: 2700, ownerCents: 1800 }); // 60/40 of the allocated basis
    expect(repo.redemptions).toHaveLength(1);
  });

  it('rejects a second redemption of the same service line', async () => {
    const e = await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    await svc.redeemBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1', serviceLineId: 'sl1', technicianId: 't1' });
    await expect(svc.redeemBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1', serviceLineId: 'sl1' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('coverage', () => {
  it('summarizes covered services + member discounts for a ticket', async () => {
    repo.seedTicket('tk1', 'c1');
    repo.seedServiceLine('sl1', { serviceId: 's1', priceCents: 6000, serviceName: 'Gel Manicure' });
    const e = await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    await svc.redeemBenefit(ctx, { membershipId: e.membershipId, benefitId: 'b1', ticketId: 'tk1', serviceLineId: 'sl1', technicianId: 't1' });
    const cov = await svc.coverage(ctx, 'tk1');
    expect(cov.membership?.status).toBe('active');
    expect(cov.coveredLines).toHaveLength(1);
    expect(cov.coveredLines[0].coveredCents).toBe(6000);
    expect(cov.coveredTotalCents).toBe(6000);
    expect(cov.memberDiscounts.some((d) => d.kind === 'percent')).toBe(true); // the 15% retail discount benefit
  });

  it('returns an empty coverage for a ticket with no customer membership', async () => {
    repo.seedTicket('tk2', 'cX');
    const cov = await svc.coverage(ctx, 'tk2');
    expect(cov.membership).toBeNull();
    expect(cov.coveredTotalCents).toBe(0);
  });
});

describe('welcome comms hook', () => {
  it('fires sendWelcome on a successful enroll', async () => {
    const calls: string[] = [];
    const svc2 = new MembershipEnrollService(repo, { sendWelcome: async (_c: any, id: string) => { calls.push(id); return { sent: true, skipped: false }; } });
    const e = await svc2.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    expect(calls).toEqual([e.membershipId]);
  });

  it('still enrolls when the welcome comms throws (best-effort)', async () => {
    const svc2 = new MembershipEnrollService(repo, { sendWelcome: async () => { throw new Error('comms down'); } });
    const e = await svc2.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    expect(e.membershipId).toBeTruthy();
  });
});

describe('batch member status', () => {
  it('returns only customers who are active members (deduped)', async () => {
    repo.seedCustomer('c2', 'Mia');
    await svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });
    const res = await svc.membershipsByCustomers(ctx, ['c1', 'c2', 'c1']);
    expect(res.members).toHaveLength(1);
    expect(res.members[0]).toMatchObject({ customerId: 'c1', isMember: true });
    expect(res.members[0].planName).toBeTruthy();
    expect(['active', 'trial', 'grace', 'comped']).toContain(res.members[0].status);
  });

  it('returns empty for no ids', async () => {
    const res = await svc.membershipsByCustomers(ctx, []);
    expect(res.members).toEqual([]);
  });
});

describe('membership lifecycle (cancel/pause/resume)', () => {
  const enroll = () => svc.enroll(ctx, { customerId: 'c1', planId: 'p1', autoRenewConsent: true });

  it('cancels at period end: canceling, auto_renew off, version bumped', async () => {
    const e = await enroll();
    const r = await svc.cancelMembership(ctx, e.membershipId, { atPeriodEnd: true, reason: 'too pricey' });
    expect(r.status).toBe('canceling');
    expect(r.cancelAtPeriodEnd).toBe(true);
    const after = await repo.loadForLifecycle(ctx, e.membershipId);
    expect(after?.autoRenew).toBe(false);
    expect(after?.version).toBe(1);
  });

  it('hard-cancels a canceling membership (active → canceling → canceled)', async () => {
    const e = await enroll();
    await svc.cancelMembership(ctx, e.membershipId, { atPeriodEnd: true });   // -> canceling
    const r = await svc.cancelMembership(ctx, e.membershipId, { atPeriodEnd: false }); // canceling -> canceled
    expect(r.status).toBe('canceled');
  });

  it('pauses then resumes an active membership', async () => {
    const e = await enroll();
    expect((await svc.pauseMembership(ctx, e.membershipId, {})).status).toBe('paused');
    expect((await svc.resumeMembership(ctx, e.membershipId, {})).status).toBe('active');
  });

  it('rejects immediate cancel from active and suggests scheduling', async () => {
    const e = await enroll();
    await expect(svc.cancelMembership(ctx, e.membershipId, { atPeriodEnd: false })).rejects.toThrow(/cancel at period end/i);
  });

  it('returns a concurrency error on a stale version', async () => {
    const e = await enroll();
    await expect(svc.cancelMembership(ctx, e.membershipId, { atPeriodEnd: true, expectedVersion: 99 })).rejects.toThrow(ConcurrencyError);
  });
});
