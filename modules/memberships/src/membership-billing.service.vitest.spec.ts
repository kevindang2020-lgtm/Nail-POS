// membership-billing.service.vitest.spec.ts — DB-free billing service tests over the in-memory repository. Covers a
// successful renewal (idempotent payment + allocation snapshot + period advance), the dunning ladder, idempotent replay,
// the honest not-configured path, the due-sweep with the default (unconfigured) charger, and proration preview.
import { describe, it, expect, beforeEach } from 'vitest';
import { MembershipBillingService } from './membership-billing.service';
import { InMemoryMembershipBillingRepository, type BillingMembership } from './membership-billing.repository';

const base: BillingMembership = {
  membershipId: 'm1', tenantId: 't1', branchId: 'b1', customerId: 'c1', customerName: 'Jess',
  planId: 'p1', planName: 'VIP', planVersionId: 'v1', status: 'active', priceCents: 8000,
  billingInterval: 'month', intervalCount: 1, techSplitPct: 60, allocationTiming: 'on_redemption',
  currentPeriodStart: new Date('2026-06-01T00:00:00Z'), currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
  nextBillingAt: new Date('2026-07-01T00:00:00Z'), startedAt: new Date('2026-06-01T00:00:00Z'), cyclesBilled: 1, autoRenew: true,
};

let repo: InMemoryMembershipBillingRepository;
let svc: MembershipBillingService;
beforeEach(() => { repo = new InMemoryMembershipBillingRepository(); svc = new MembershipBillingService(repo); });

describe('successful renewal', () => {
  it('records a settled payment, books to house on_redemption, and advances the period', async () => {
    repo.seed(base);
    const r = await svc.applyRenewalResult('m1', { status: 'succeeded', amountCents: 8000, processor: 'recorded' }, { attempt: 1 });
    expect(r).toMatchObject({ applied: true, status: 'active' });
    expect(repo.payments).toHaveLength(1);
    expect(repo.payments[0]).toMatchObject({ status: 'succeeded', amountCents: 8000, techAllocCents: 0, ownerAllocCents: 8000, settled: true });
    const snap = repo.snapshot('m1')!;
    expect(snap.cyclesBilled).toBe(2);
    expect(snap.currentPeriodStart!.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(snap.currentPeriodEnd!.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(snap.nextBillingAt!.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(repo.activities.some((a) => a.activityType === 'renewed')).toBe(true);
  });

  it('splits 60/40 when allocation is on_billing', async () => {
    repo.seed({ ...base, allocationTiming: 'on_billing' });
    await svc.applyRenewalResult('m1', { status: 'succeeded', amountCents: 10000 }, { attempt: 1 });
    expect(repo.payments[0]).toMatchObject({ techAllocCents: 6000, ownerAllocCents: 4000 });
  });
});

describe('dunning ladder', () => {
  it('steps active → grace → past_due → suspended on consecutive failures', async () => {
    repo.seed(base);
    await svc.applyRenewalResult('m1', { status: 'failed', declineReason: 'card_declined' }, { attempt: 1 });
    expect(repo.snapshot('m1')!.status).toBe('grace');
    expect(repo.snapshot('m1')!.nextBillingAt).not.toBeNull(); // retry scheduled
    await svc.applyRenewalResult('m1', { status: 'failed' }, { attempt: 2 });
    expect(repo.snapshot('m1')!.status).toBe('past_due');
    await svc.applyRenewalResult('m1', { status: 'failed' }, { attempt: 3 });
    expect(repo.snapshot('m1')!.status).toBe('suspended');
    expect(repo.payments.every((p) => p.status === 'failed')).toBe(true);
    expect(repo.payments).toHaveLength(3);
  });

  it('recovers to active on a later success', async () => {
    repo.seed({ ...base, status: 'past_due' });
    const r = await svc.applyRenewalResult('m1', { status: 'succeeded', amountCents: 8000 }, { attempt: 2 });
    expect(r.status).toBe('active');
    expect(repo.snapshot('m1')!.status).toBe('active');
  });
});

describe('idempotency', () => {
  it('a replayed charge for the same period+attempt does not double-write or double-advance', async () => {
    repo.seed(base);
    await svc.applyRenewalResult('m1', { status: 'succeeded', amountCents: 8000 }, { attempt: 1 });
    expect(repo.payments).toHaveLength(1);
    repo.seed(base); // same membership state re-delivered (duplicate)
    const dup = await svc.applyRenewalResult('m1', { status: 'succeeded', amountCents: 8000 }, { attempt: 1 });
    expect(dup).toMatchObject({ applied: false, reason: 'duplicate', duplicate: true });
    expect(repo.payments).toHaveLength(1);
  });
});

describe('honest unconfigured path', () => {
  it('applyRenewalResult rejects a not_configured result with no payment', async () => {
    repo.seed(base);
    const r = await svc.applyRenewalResult('m1', { status: 'not_configured' });
    expect(r).toMatchObject({ applied: false, reason: 'charge_not_configured' });
    expect(repo.payments).toHaveLength(0);
  });

  it('runDueRenewals with the default adapter charges nothing and changes no state', async () => {
    repo.seed(base);
    const res = await svc.runDueRenewals(new Date('2026-07-02T00:00:00Z'));
    expect(res).toMatchObject({ due: 1, succeeded: 0, failed: 0, notConfigured: 1 });
    expect(repo.payments).toHaveLength(0);
    expect(repo.snapshot('m1')!.status).toBe('active');
  });
});

describe('proration preview', () => {
  it('computes the net charge for a mid-cycle upgrade without charging', async () => {
    repo.seed(base);
    const p = await svc.previewProration('m1', 12000, '2026-06-16T00:00:00Z');
    expect(p!.netChargeCents).toBe(2000);
    expect(repo.payments).toHaveLength(0);
  });
});

describe('payment-failed comms hook', () => {
  it('fires notifyPaymentFailed on a failed renewal', async () => {
    const calls: string[] = [];
    const svc2 = new MembershipBillingService(repo, undefined, { notifyPaymentFailed: async (_c: any, id: string) => { calls.push(id); return { sent: true, skipped: false }; } });
    repo.seed(base);
    await svc2.applyRenewalResult('m1', { status: 'failed', declineReason: 'card_declined' }, { attempt: 1 });
    expect(calls).toEqual(['m1']);
  });

  it('does not fire on a successful renewal', async () => {
    const calls: string[] = [];
    const svc2 = new MembershipBillingService(repo, undefined, { notifyPaymentFailed: async (_c: any, id: string) => { calls.push(id); return { sent: true, skipped: false }; } });
    repo.seed(base);
    await svc2.applyRenewalResult('m1', { status: 'succeeded', amountCents: 8000 }, { attempt: 1 });
    expect(calls).toEqual([]);
  });
});
