// dashboard.service.ts — Super-Admin dashboard orchestration. Thin: pulls facts + plan prices from the port and runs
// the pure aggregator. Window/threshold can be overridden per request. No I/O beyond the injected port.
import { buildDashboardOverview } from './dashboard-core';
import type { SuperAdminDashboardOverview } from './dashboard.dto';
import type { DashboardDataPort } from './dashboard.repository';

export interface OverviewQuery { newWindowDays?: number; usageThresholdPercent?: number }

export class SuperAdminDashboardService {
  constructor(private readonly repo: DashboardDataPort) {}

  async getOverview(q: OverviewQuery = {}): Promise<SuperAdminDashboardOverview> {
    const [facts, planPrices] = await Promise.all([this.repo.getFacts(), this.repo.getPlanPrices()]);
    return buildDashboardOverview(facts, { planPrices, newWindowDays: q.newWindowDays, usageThresholdPercent: q.usageThresholdPercent });
  }
}
