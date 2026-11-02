// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type PlanDirectoryRow = {
  id: string; code: string; name: string; subtitle: string | null;
  planType: string; status: string;
  monthlyPriceCents: number; annualPriceCents: number | null;
  isRecommended: boolean; isPublic: boolean; displayOrder: number;
  tenantCount: number;            // active subscriptions whose plan text maps to this catalog plan
  enabledFeatureCount: number;
  limits: Record<string, number | null>; // metric -> value (null = unlimited)
};

export type PlansOverview = {
  kpis: {
    totalPlans: number;
    activePlans: number;
    publicPlans: number;
    activeTenantsOnPlans: number;       // total active subscriptions
    mappedActiveTenants: number;        // active subs that matched a catalog plan
    unmappedActiveSubscriptions: number;// active subs matching no catalog plan (honest)
    monthlyPlanRevenueCents: number;    // sum over mapped active subs of plan monthly price
    unlimitedPackages: number;          // active subs mapped to an 'unlimited'-type plan
    notModeled: string[];               // KPI keys with no data source yet -> UI renders honest gap
  };
  plans: PlanDirectoryRow[];
  planDistribution: { code: string; name: string; tenantCount: number }[];
  overagePricing: { metric: string; unitPriceCents: number; tenants: number; revenueCents: number }[];
  overageTotalRevenueCents: number;
  addOns: AddOnPerf[];
  trialsPromotions: TrialPromo[];
  tenantSubscriptions: TenantSubscription[];
  featureAdoption: FeatureAdoption[];
  utilizationTrend: UtilizationTrendPoint[];
};

export type TenantSubscription = { tenantId: string; name: string; planText: string | null; planCode: string | null; monthlyPriceCents: number | null; status: string | null };

export type Strategy = 'immediate' | 'end_of_cycle';

export type ChangePreview = {
  tenantId: string;
  from: { planCode: string | null; planText: string | null; monthlyPriceCents: number | null };
  to: { planCode: string; name: string; monthlyPriceCents: number };
  changeType: ChangeType; strategy: Strategy; effectiveAt: string;
  proration: { remainingFraction: number; creditCents: number; chargeCents: number; netCents: number };
};

export type OverageRuleDetail = { metric: string; unitPriceCents: number; graceAmount: number; warningThresholdPct: number | null };

export type GrandfatherRow = {
  tenantId: string; tenantName: string; planCode: string | null; versionNumber: number | null;
  lockedMonthlyPriceCents: number | null; effectiveFrom: string | null; endDate: string | null;
  migrationTargetPlanCode: string | null; reason: string | null; createdAt: string;
};

export type AddOnPerf = { code: string; name: string; pricingModel: string; unitPriceCents: number; status: string; tenantCount: number; monthlyRevenueCents: number };

export type UtilizationTrendPoint = { capturedOn: string; tenants: number; tenantsNear: number; tenantsOver: number; avgMaxPct: number };

export type TrialPromo = { kind: 'trial' | 'promotion'; code: string; name: string; tenantCount: number; endsOn: string | null; detail: string | null };

export type FeatureAdoption = { featureKey: string; enabledPlans: number; tenantEnabled: number };

export type ChangeType = 'initial' | 'upgrade' | 'downgrade' | 'crossgrade';
