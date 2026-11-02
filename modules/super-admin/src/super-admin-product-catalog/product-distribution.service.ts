// Master→tenant distribution service. Plans per-tenant actions (create / skip-existing / already-distributed) via the
// pure engine, then records each. Idempotent (unique master+tenant), preserves tenant customizations (never
// overwrites), and never creates branch inventory. Retrying the same push produces no duplicate tenant products.

import { planDistribution, summarizeDistribution, statusForAction, type DistributionPlanItem } from './product-distribution-core';
import type { DistributionRepo, DistributionRow } from './product-distribution.repository';

export class ProductDistributionService {
  constructor(private readonly repo: DistributionRepo) {}

  list(scope: { masterProductId?: string; tenantId?: string; cap?: number } = {}) { return this.repo.listDistributions(scope); }

  async distribute(input: { masterProductId: string; tenantIds: string[]; reason?: string; skipExisting?: boolean; createdByUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; summary?: ReturnType<typeof summarizeDistribution>; results?: { tenantId: string; action: string; distributionId?: string; tenantProductId?: string | null }[] }> {
    const tenantIds = (input.tenantIds || []).filter(Boolean);
    if (!tenantIds.length) return { ok: false, errors: ['Select at least one tenant.'] };
    if (!(await this.repo.masterExists(input.masterProductId))) return { ok: false, errors: ['Master product not found.'] };

    const [alreadyDistributed, carrying] = await Promise.all([
      this.repo.alreadyDistributedTenants(input.masterProductId),
      this.repo.tenantsCarrying(input.masterProductId, tenantIds),
    ]);
    const skipExisting = input.skipExisting !== false; // default: skip tenants already carrying the product
    const plan: DistributionPlanItem[] = planDistribution(tenantIds, { alreadyDistributedTenantIds: alreadyDistributed, tenantsAlreadyCarrying: carrying, skipExisting });

    const results: { tenantId: string; action: string; distributionId?: string; tenantProductId?: string | null }[] = [];
    for (const item of plan) {
      if (item.action === 'already_distributed') { results.push({ tenantId: item.tenantId, action: item.action }); continue; }
      const row: DistributionRow = await this.repo.recordDistribution({
        masterProductId: input.masterProductId, tenantId: item.tenantId, status: statusForAction(item.action),
        reason: input.reason ?? null, createdByUserId: input.createdByUserId ?? null,
      });
      results.push({ tenantId: item.tenantId, action: item.action, distributionId: row.id, tenantProductId: row.tenantProductId });
    }
    return { ok: true, summary: summarizeDistribution(plan), results };
  }
}
