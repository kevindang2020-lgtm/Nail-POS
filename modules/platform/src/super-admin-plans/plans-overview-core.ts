import type { PlanDirectoryRow, PlansOverview, TenantSubscription, AddOnPerf, UtilizationTrendPoint, TrialPromo, FeatureAdoption } from '@aipowersalon/api-contracts/platform';
export type { PlanDirectoryRow, PlansOverview, TenantSubscription, AddOnPerf, UtilizationTrendPoint, TrialPromo, FeatureAdoption };   // owned by packages/api-contracts (Constitution 13 §13)
// plans-overview-core.ts — pure, deterministic aggregator for Super Admin → Plans & Feature Limits (read-only overview).
// No I/O, no fabrication. Computes only what real data supports; everything not yet modeled is named in kpis.notModeled
// so the UI can render an honest gap (—/NotConnected) instead of a fake number. Money is integer cents throughout.

export type PlanRow = {
  id: string; code: string; name: string; subtitle: string | null;
  plan_type: string; status: string;
  monthly_price_cents: number; annual_price_cents: number | null;
  is_recommended: boolean; is_public: boolean; display_order: number;
};
export type LimitRow = { plan_id: string; metric: string; limit_value: number | null };
export type FeatureCountRow = { plan_id: string; enabled_count: number };
export type SubFact = { plan: string; status: string };
export type OverageRow = { metric: string; unit_price_cents: number; tenants?: number; revenue_cents?: number };



// KPIs the reference page shows but which require tables/metering not yet built. Named explicitly = honest gaps.
export const NOT_MODELED_KPIS = [
  'trialTenants',
  'addOnRevenueCents',
  'overLimitTenants',
  'averagePlanUtilizationPct',
  'aiMinutesUsedMonth',
  'activePromotionalPlans',
] as const;

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

export function buildPlansOverview(
  planRows: PlanRow[],
  limitRows: LimitRow[],
  featureCounts: FeatureCountRow[],
  subFacts: SubFact[],
  overageRows: OverageRow[],
  addOns: AddOnPerf[] = [],
  trialsPromotions: TrialPromo[] = [],
  tenantSubscriptions: TenantSubscription[] = [],
  featureAdoption: FeatureAdoption[] = [],
  utilizationTrend: UtilizationTrendPoint[] = [],
): PlansOverview {
  const limitsByPlan = new Map<string, Record<string, number | null>>();
  for (const l of limitRows) {
    const m = limitsByPlan.get(l.plan_id) ?? {};
    m[l.metric] = l.limit_value;
    limitsByPlan.set(l.plan_id, m);
  }
  const featureCountByPlan = new Map<string, number>();
  for (const f of featureCounts) featureCountByPlan.set(f.plan_id, f.enabled_count);

  // Index catalog plans by their matchable keys (code + name), so a free-text subscription plan can be mapped.
  const byKey = new Map<string, PlanRow>();
  for (const p of planRows) {
    byKey.set(norm(p.code), p);
    byKey.set(norm(p.name), p);
  }

  const activeSubs = subFacts.filter((s) => norm(s.status) === 'active');
  const tenantCountByPlanId = new Map<string, number>();
  let mappedActiveTenants = 0;
  let monthlyPlanRevenueCents = 0;
  let unlimitedPackages = 0;
  for (const s of activeSubs) {
    const p = byKey.get(norm(s.plan));
    if (!p) continue;
    mappedActiveTenants++;
    tenantCountByPlanId.set(p.id, (tenantCountByPlanId.get(p.id) ?? 0) + 1);
    monthlyPlanRevenueCents += p.monthly_price_cents;
    if (norm(p.plan_type) === 'unlimited') unlimitedPackages++;
  }

  const plans: PlanDirectoryRow[] = [...planRows]
    .sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id, code: p.code, name: p.name, subtitle: p.subtitle,
      planType: p.plan_type, status: p.status,
      monthlyPriceCents: p.monthly_price_cents, annualPriceCents: p.annual_price_cents,
      isRecommended: p.is_recommended, isPublic: p.is_public, displayOrder: p.display_order,
      tenantCount: tenantCountByPlanId.get(p.id) ?? 0,
      enabledFeatureCount: featureCountByPlan.get(p.id) ?? 0,
      limits: limitsByPlan.get(p.id) ?? {},
    }));

  const planDistribution = plans.map((p) => ({ code: p.code, name: p.name, tenantCount: p.tenantCount }));

  const overagePricing = [...overageRows]
    .map((o) => ({ metric: o.metric, unitPriceCents: o.unit_price_cents, tenants: o.tenants ?? 0, revenueCents: o.revenue_cents ?? 0 }))
    .sort((a, b) => a.metric.localeCompare(b.metric));
  const overageTotalRevenueCents = overagePricing.reduce((s, o) => s + o.revenueCents, 0);

  return {
    kpis: {
      totalPlans: planRows.length,
      activePlans: planRows.filter((p) => norm(p.status) === 'active').length,
      publicPlans: planRows.filter((p) => p.is_public).length,
      activeTenantsOnPlans: activeSubs.length,
      mappedActiveTenants,
      unmappedActiveSubscriptions: activeSubs.length - mappedActiveTenants,
      monthlyPlanRevenueCents,
      unlimitedPackages,
      notModeled: [...NOT_MODELED_KPIS],
    },
    plans,
    planDistribution,
    overagePricing,
    overageTotalRevenueCents,
    addOns: [...addOns].sort((a, b) => b.monthlyRevenueCents - a.monthlyRevenueCents || a.name.localeCompare(b.name)),
    trialsPromotions: [...trialsPromotions].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'trial' ? -1 : 1)),
    tenantSubscriptions: [...tenantSubscriptions].sort((a, b) => a.name.localeCompare(b.name)),
    featureAdoption: [...featureAdoption].sort((a, b) => b.enabledPlans - a.enabledPlans || b.tenantEnabled - a.tenantEnabled || a.featureKey.localeCompare(b.featureKey)),
    utilizationTrend: [...utilizationTrend],
  };
}
