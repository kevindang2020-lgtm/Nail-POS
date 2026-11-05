// Campaign delivery service. Exposes real Delivery Rate + Opt-out Rate (from rollups) and the categorized failure
// summary + list. Failures expose only safe masked destinations and provider status — never raw contact info.

import { computeDeliveryKpis, summarizeFailures } from './campaign-delivery-core';
import { buildTrend } from './campaign-trend-core';
import type { DeliveryRepo, FailureRow } from './campaign-delivery.repository';

export class CampaignDeliveryService {
  constructor(private readonly repo: DeliveryRepo) {}

  // tenantId from the VERIFIED session. These read tenant-owned delivery data; without it they return nothing.
  async deliveryKpis(tenantId: string): Promise<{ deliveryRate: number | null; optOutRate: number | null }> {
    return computeDeliveryKpis(await this.repo.deliveryTotals(tenantId));
  }

  async performanceTrend(days = 7) {
    return buildTrend(await this.repo.metricSnapshots(days));
  }

  async failureSummary(tenantId: string) {
    const counts = await this.repo.failureCounts(tenantId);
    if (counts.length === 0) return { available: true, total: 0, byCategory: [] as { category: string; label: string; count: number; pct: number }[] };
    return summarizeFailures(counts);
  }

  listFailures(tenantId: string, scope: { category?: string } = {}): Promise<FailureRow[]> {
    return this.repo.listFailures({ ...scope, tenantId });
  }
}
