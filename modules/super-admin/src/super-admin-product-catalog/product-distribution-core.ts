// Pure, DB-free engine for optional master→tenant distribution. Decides, per tenant, whether to create a tenant-owned
// product, skip because the tenant already carries it, or no-op because it was already distributed. Enforces
// idempotency and skip-existing in logic, before any write. No branch inventory is ever considered here.

export type DistributionAction = 'create' | 'skip_existing' | 'already_distributed';

export interface DistributionContext {
  alreadyDistributedTenantIds: Set<string>;   // (master, tenant) distribution already exists
  tenantsAlreadyCarrying: Set<string>;         // tenant already has a product matching the master (e.g. same SKU)
  skipExisting: boolean;                       // when true, tenants already carrying are skipped instead of duplicated
}

export interface DistributionPlanItem { tenantId: string; action: DistributionAction }

export function planDistribution(tenantIds: string[], ctx: DistributionContext): DistributionPlanItem[] {
  const seen = new Set<string>();
  const plan: DistributionPlanItem[] = [];
  for (const tenantId of tenantIds) {
    if (seen.has(tenantId)) continue;           // de-dupe repeated tenant ids in the request
    seen.add(tenantId);
    let action: DistributionAction;
    if (ctx.alreadyDistributedTenantIds.has(tenantId)) action = 'already_distributed';
    else if (ctx.tenantsAlreadyCarrying.has(tenantId) && ctx.skipExisting) action = 'skip_existing';
    else action = 'create';
    plan.push({ tenantId, action });
  }
  return plan;
}

export interface DistributionSummary { total: number; created: number; skippedExisting: number; alreadyDistributed: number }

export function summarizeDistribution(plan: DistributionPlanItem[]): DistributionSummary {
  return {
    total: plan.length,
    created: plan.filter((p) => p.action === 'create').length,
    skippedExisting: plan.filter((p) => p.action === 'skip_existing').length,
    alreadyDistributed: plan.filter((p) => p.action === 'already_distributed').length,
  };
}

export const statusForAction = (a: DistributionAction): 'distributed' | 'skipped_existing' =>
  a === 'create' ? 'distributed' : 'skipped_existing';
