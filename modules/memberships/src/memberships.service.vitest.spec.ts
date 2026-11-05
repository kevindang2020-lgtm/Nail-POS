// memberships.service.vitest.spec.ts — DB-free service tests over the in-memory repository: overview shape on empty
// data (never faked), plan create/list/get roundtrip, immutable version publish, and the input validation the engine
// enforces (split must total 100%, product type constrained, plan must exist).
import { describe, it, expect, beforeEach } from 'vitest';
import { MembershipsService, ValidationError } from './memberships.service';
import { InMemoryMembershipsRepository, type MembershipsContext } from './memberships.repository';

const ctx: MembershipsContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['customers.view', 'customers.edit'] };
let svc: MembershipsService;
beforeEach(() => { svc = new MembershipsService(new InMemoryMembershipsRepository()); });

describe('overview', () => {
  it('returns zeroed KPIs and empty panels on empty data (no fabricated numbers)', async () => {
    const o = await svc.getOverview(ctx, {});
    expect(o.kpis.totalMembers).toBe(0);
    expect(o.kpis.activeMembers).toBe(0);
    expect(o.kpis.membershipRevenueCents).toBe(0);
    expect(o.kpis.revenueDeltaPct).toBeNull();
    expect(o.plans).toEqual([]);
    expect(o.members).toEqual([]);
    expect(o.activity).toEqual([]);
    expect(o.rangeDays).toBe(30);
    expect(o.kpis.expiringWindowDays).toBe(7);
  });

  it('clamps range filters to sane bounds', async () => {
    const o = await svc.getOverview(ctx, { rangeDays: 9999, expiringWindowDays: 0 });
    expect(o.rangeDays).toBe(365);
    expect(o.kpis.expiringWindowDays).toBe(1);
  });
});

describe('plan create / list', () => {
  it('creates a draft plan and lists it', async () => {
    const { planId } = await svc.createPlan(ctx, { name: 'VIP Nail Club', productType: 'recurring', isPopular: true, badge: 'Most Popular' });
    const plans = await svc.listPlans(ctx);
    expect(plans).toHaveLength(1);
    expect(plans[0].planId).toBe(planId);
    expect(plans[0].name).toBe('VIP Nail Club');
    expect(plans[0].status).toBe('draft');
    expect(plans[0].isPopular).toBe(true);
    expect(plans[0].memberCount).toBe(0);
  });

  it('rejects an empty name and unknown product type', async () => {
    await expect(svc.createPlan(ctx, { name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.createPlan(ctx, { name: 'X', productType: 'lifetime' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('surfaces the new plan in the overview', async () => {
    await svc.createPlan(ctx, { name: 'Gel Polish Plus' });
    const o = await svc.getOverview(ctx, {});
    expect(o.plans.map((p) => p.name)).toContain('Gel Polish Plus');
  });
});

describe('publish immutable version', () => {
  it('publishes a version, activates the plan, and stores benefits', async () => {
    const { planId } = await svc.createPlan(ctx, { name: 'Spa Pedicure Club' });
    const { versionNumber } = await svc.publishVersion(ctx, planId, {
      billingInterval: 'month', priceCents: 4999, techSplitPct: 60, ownerSplitPct: 40,
      benefits: [{ benefitType: 'service_credit', label: 'One spa pedicure', creditsPerCycle: 1, allocatedValueCents: 4500 }],
    });
    expect(versionNumber).toBe(1);
    const detail = await svc.getPlan(ctx, planId);
    expect(detail.status).toBe('active');
    expect(detail.version?.priceCents).toBe(4999);
    expect(detail.version?.techSplitPct).toBe(60);
    expect(detail.version?.benefits).toHaveLength(1);
    expect(detail.version?.benefits[0].creditsPerCycle).toBe(1);

    // a second publish creates version 2 (immutable history — versions increment)
    const second = await svc.publishVersion(ctx, planId, { billingInterval: 'month', priceCents: 5499 });
    expect(second.versionNumber).toBe(2);
  });

  it('rejects a split that does not total 100%', async () => {
    const { planId } = await svc.createPlan(ctx, { name: 'Basic Care Plan' });
    await expect(svc.publishVersion(ctx, planId, { priceCents: 2999, techSplitPct: 70, ownerSplitPct: 40 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects publishing or fetching a plan that does not exist', async () => {
    await expect(svc.publishVersion(ctx, 'nope', { priceCents: 1000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.getPlan(ctx, 'nope')).rejects.toBeInstanceOf(ValidationError);
  });
});
