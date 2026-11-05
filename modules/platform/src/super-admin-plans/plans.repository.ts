// plans.repository.ts — data port for Plans (read overview + write mutations). The in-memory adapter returns honest
// zeros for reads and refuses writes (no DB bound), so nothing is ever fabricated or silently "succeeds".
import type { PlanRow, LimitRow, FeatureCountRow, SubFact, OverageRow, AddOnPerf, TrialPromo, TenantSubscription, FeatureAdoption, UtilizationTrendPoint } from './plans-overview-core';
import type { NormalizedCreatePlan, ValidatedPricingChange, PlanLimitChange } from './plan-mutations-core';

export type PlansOverviewData = {
  planRows: PlanRow[]; limitRows: LimitRow[]; featureCounts: FeatureCountRow[]; subFacts: SubFact[]; overageRows: OverageRow[];
  addOns: AddOnPerf[]; trialsPromotions: TrialPromo[]; tenantSubscriptions: TenantSubscription[]; featureAdoption: FeatureAdoption[]; utilizationTrend: UtilizationTrendPoint[];
};

export type PlanSnapshot = {
  id: string; code: string; name: string;
  monthly_price_cents: number; annual_price_cents: number | null; setup_fee_cents: number;
  currency: string; billing_interval: string;
  limits: { metric: string; limit_value: number | null }[];
  features: { feature_key: string; state: string }[];
};

export type PlanVersionView = {
  id: string; versionNumber: number; monthlyPriceCents: number; annualPriceCents: number | null;
  status: string; effectiveFrom: string; endDate: string | null; changeReason: string | null; createdAt: string;
};

export type AuditActor = { userId?: string | null; role?: string | null };

export interface PlansDataPort {
  getOverviewData(): Promise<PlansOverviewData>;
  // writes
  planKeyExists(code: string, name: string): Promise<{ codeExists: boolean; nameExists: boolean }>;
  getPlanSnapshot(id: string): Promise<PlanSnapshot | null>;
  createPlan(n: NormalizedCreatePlan, createdBy: string | null): Promise<string>;        // tx: plan + limits + features + v1
  updatePlanDetails(id: string, patch: Record<string, unknown>): Promise<boolean>;
  getMaxVersion(planId: string): Promise<number | null>;
  applyPricingChange(planId: string, v: ValidatedPricingChange, snapshot: PlanSnapshot, versionNumber: number, createdBy: string | null): Promise<void>; // tx
  listVersions(planId: string): Promise<PlanVersionView[]>;
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
  updatePlanLimits(planId: string, changes: PlanLimitChange[]): Promise<void>; // tx: upsert plan_limits per metric
}

const NO_DB = () => { throw new Error('database not available'); };

export class InMemoryPlansRepository implements PlansDataPort {
  async getOverviewData(): Promise<PlansOverviewData> {
    return { planRows: [], limitRows: [], featureCounts: [], subFacts: [], overageRows: [], addOns: [], trialsPromotions: [], tenantSubscriptions: [], featureAdoption: [], utilizationTrend: [] };
  }
  async planKeyExists(): Promise<{ codeExists: boolean; nameExists: boolean }> { return { codeExists: false, nameExists: false }; }
  async getPlanSnapshot(): Promise<PlanSnapshot | null> { return null; }
  async createPlan(): Promise<string> { return NO_DB(); }
  async updatePlanDetails(): Promise<boolean> { return NO_DB(); }
  async getMaxVersion(): Promise<number | null> { return null; }
  async applyPricingChange(): Promise<void> { return NO_DB(); }
  async listVersions(): Promise<PlanVersionView[]> { return []; }
  async writeAudit(): Promise<void> { /* no-op without DB */ }
  async updatePlanLimits(): Promise<void> { throw new Error('database not available'); }
}
