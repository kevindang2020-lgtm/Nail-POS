import { describe, it, expect } from 'vitest';
import { buildPlansOverview, NOT_MODELED_KPIS, type PlanRow, type LimitRow, type SubFact } from './plans-overview-core';

const plan = (over: Partial<PlanRow> & Pick<PlanRow, 'id' | 'code' | 'name'>): PlanRow => ({
  subtitle: null, plan_type: 'standard', status: 'active', monthly_price_cents: 0, annual_price_cents: null,
  is_recommended: false, is_public: true, display_order: 0, ...over,
});

const PLANS: PlanRow[] = [
  plan({ id: 'p1', code: 'starter', name: 'Starter', monthly_price_cents: 0, display_order: 1 }),
  plan({ id: 'p2', code: 'professional', name: 'Professional', monthly_price_cents: 9900, display_order: 2 }),
  plan({ id: 'p5', code: 'unlimited', name: 'Unlimited', plan_type: 'unlimited', monthly_price_cents: 69900, display_order: 5, is_public: false, status: 'inactive' }),
];
const LIMITS: LimitRow[] = [
  { plan_id: 'p2', metric: 'customers', limit_value: 2500 },
  { plan_id: 'p5', metric: 'customers', limit_value: null }, // unlimited
];

describe('buildPlansOverview', () => {
  it('maps active subscriptions to catalog plans by code or name (case-insensitive)', () => {
    const subs: SubFact[] = [
      { plan: 'Professional', status: 'active' },   // matches by name
      { plan: 'professional', status: 'active' },   // matches by code
      { plan: 'unlimited', status: 'active' },      // unlimited type
      { plan: 'Standard', status: 'active' },       // matches nothing -> unmapped
      { plan: 'professional', status: 'cancelled' },// not active -> ignored
    ];
    const o = buildPlansOverview(PLANS, LIMITS, [{ plan_id: 'p2', enabled_count: 11 }], subs, []);
    expect(o.kpis.totalPlans).toBe(3);
    expect(o.kpis.activePlans).toBe(2);            // p5 is inactive
    expect(o.kpis.publicPlans).toBe(2);            // p5 is private
    expect(o.kpis.activeTenantsOnPlans).toBe(4);
    expect(o.kpis.mappedActiveTenants).toBe(3);
    expect(o.kpis.unmappedActiveSubscriptions).toBe(1);
    expect(o.kpis.unlimitedPackages).toBe(1);
    // revenue = 2 professionals * 9900 + 1 unlimited * 69900 (starter $0 has no subs)
    expect(o.kpis.monthlyPlanRevenueCents).toBe(9900 * 2 + 69900);
  });

  it('exposes per-plan limits (null = unlimited), feature counts, and a sorted directory', () => {
    const o = buildPlansOverview(PLANS, LIMITS, [{ plan_id: 'p2', enabled_count: 11 }], [], []);
    expect(o.plans.map((p) => p.code)).toEqual(['starter', 'professional', 'unlimited']); // by display_order
    const pro = o.plans.find((p) => p.code === 'professional')!;
    expect(pro.limits.customers).toBe(2500);
    expect(pro.enabledFeatureCount).toBe(11);
    expect(o.plans.find((p) => p.code === 'unlimited')!.limits.customers).toBeNull();
  });

  it('always reports not-modeled KPIs as honest gaps and never fabricates them', () => {
    const o = buildPlansOverview(PLANS, [], [], [], []);
    expect(o.kpis.notModeled).toEqual([...NOT_MODELED_KPIS]);
    expect(o.kpis.monthlyPlanRevenueCents).toBe(0);
    expect(o.kpis.activeTenantsOnPlans).toBe(0);
  });

  it('passes through real overage pricing, sorted by metric', () => {
    const o = buildPlansOverview(PLANS, [], [], [], [
      { metric: 'sms_monthly', unit_price_cents: 1 },
      { metric: 'ai_minutes_monthly', unit_price_cents: 5 },
    ]);
    expect(o.overagePricing).toEqual([
      { metric: 'ai_minutes_monthly', unitPriceCents: 5, tenants: 0, revenueCents: 0 },
      { metric: 'sms_monthly', unitPriceCents: 1, tenants: 0, revenueCents: 0 },
    ]);
    expect(o.overageTotalRevenueCents).toBe(0);
  });

  it('passes through add-ons (revenue-sorted) and trials/promotions (trials first)', () => {
    const o = buildPlansOverview(PLANS, [], [], [], [],
      [
        { code: 'a', name: 'A', pricingModel: 'monthly', unitPriceCents: 100, status: 'active', tenantCount: 0, monthlyRevenueCents: 0 },
        { code: 'b', name: 'B', pricingModel: 'monthly', unitPriceCents: 200, status: 'active', tenantCount: 3, monthlyRevenueCents: 600 },
      ],
      [
        { kind: 'promotion', code: 'p', name: 'Spring', tenantCount: 0, endsOn: null, detail: '20% off' },
        { kind: 'trial', code: 't', name: 'Starter Trial', tenantCount: 0, endsOn: null, detail: '7-day trial' },
      ],
    );
    expect(o.addOns.map((a) => a.code)).toEqual(['b', 'a']);            // revenue desc
    expect(o.trialsPromotions.map((x) => x.kind)).toEqual(['trial', 'promotion']); // trials first
  });
});
