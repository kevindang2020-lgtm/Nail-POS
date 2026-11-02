// entitlements.repository.ts — data port for tenant entitlements (read plan defaults + overrides + real usage; write
// overrides; audit). In-memory adapter returns honest empties for reads and refuses writes (no DB bound).
export type ActiveLimitOverride = { metric: string; limit_value: number | null; enforcement: string; reason: string | null; expires_at: string | null };
export type ActiveFeatureOverride = { feature_key: string; state: string; reason: string | null; expires_at: string | null };
export type CatalogPlanRef = { id: string; code: string; name: string };
export type AuditActor = { userId?: string | null; role?: string | null };

export type LimitOverrideWrite = { metric: string; limitValue: number | null; enforcement: string; reason: string | null; expiresAt: string | null; createdBy: string | null };
export type FeatureOverrideWrite = { featureKey: string; state: string; reason: string | null; expiresAt: string | null; createdBy: string | null };

export interface EntitlementsRepo {
  tenantExists(tenantId: string): Promise<boolean>;
  listActiveTenants(): Promise<{ id: string; name: string; planText: string | null }[]>;
  getActivePlanText(tenantId: string): Promise<string | null>;
  mapCatalogPlan(planText: string): Promise<CatalogPlanRef | null>;
  getPlanLimits(planId: string): Promise<Record<string, number | null>>;
  getPlanFeatureStates(planId: string): Promise<Record<string, string>>;
  getLimitOverrides(tenantId: string): Promise<ActiveLimitOverride[]>;
  getFeatureOverrides(tenantId: string): Promise<ActiveFeatureOverride[]>;
  getUsedCounts(tenantId: string): Promise<Record<string, number>>;
  recordUsage(tenantId: string, metric: string, amount: number, period: string): Promise<number>;
  upsertUtilizationSnapshot(s: { tenants: number; tenantsNear: number; tenantsOver: number; avgMaxPct: number }): Promise<void>;
  getUtilizationTrend(limit: number): Promise<{ capturedOn: string; tenants: number; tenantsNear: number; tenantsOver: number; avgMaxPct: number }[]>;
  upsertLimitOverride(tenantId: string, o: LimitOverrideWrite): Promise<void>;
  deleteLimitOverride(tenantId: string, metric: string): Promise<boolean>;
  upsertFeatureOverride(tenantId: string, f: FeatureOverrideWrite): Promise<void>;
  deleteFeatureOverride(tenantId: string, featureKey: string): Promise<boolean>;
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const NO_DB = () => { throw new Error('database not available'); };

export class InMemoryEntitlementsRepo implements EntitlementsRepo {
  async tenantExists(): Promise<boolean> { return false; }
  async listActiveTenants(): Promise<{ id: string; name: string; planText: string | null }[]> { return []; }
  async getActivePlanText(): Promise<string | null> { return null; }
  async mapCatalogPlan(): Promise<CatalogPlanRef | null> { return null; }
  async getPlanLimits(): Promise<Record<string, number | null>> { return {}; }
  async getPlanFeatureStates(): Promise<Record<string, string>> { return {}; }
  async getLimitOverrides(): Promise<ActiveLimitOverride[]> { return []; }
  async getFeatureOverrides(): Promise<ActiveFeatureOverride[]> { return []; }
  async getUsedCounts(): Promise<Record<string, number>> { return {}; }
  async recordUsage(): Promise<number> { throw new Error('database not available'); }
  async upsertUtilizationSnapshot(): Promise<void> { /* no-op */ }
  async getUtilizationTrend(): Promise<{ capturedOn: string; tenants: number; tenantsNear: number; tenantsOver: number; avgMaxPct: number }[]> { return []; }
  async upsertLimitOverride(): Promise<void> { return NO_DB(); }
  async deleteLimitOverride(): Promise<boolean> { return NO_DB(); }
  async upsertFeatureOverride(): Promise<void> { return NO_DB(); }
  async deleteFeatureOverride(): Promise<boolean> { return NO_DB(); }
  async writeAudit(): Promise<void> { /* no-op without DB */ }
}
