// overview.service.ts — orchestrates the Super-Admin Overview: pulls facts from the port, runs the pure core.
import type { OverviewDataPort } from './overview.repository';
import { buildOverview } from './overview-core';
import type { OverviewState, Range, SalesPoint } from './overview.dto';
import type { OverviewScope } from '@aipowersalon/database';

export class SuperAdminOverviewService {
  constructor(private readonly repo: OverviewDataPort) {}

  async getState(range: Range = 'month', role?: string | null, scope?: OverviewScope): Promise<OverviewState> {
    const facts = await this.repo.getFacts(range, scope);
    return buildOverview(facts, role);
  }

  async getMonthlySalesVolume(range: Range = 'month'): Promise<{ range: Range; series: SalesPoint[] }> {
    const facts = await this.repo.getFacts(range);
    return { range, series: facts.salesSeries };
  }

  /** Captures this month's KPI snapshot so next month's trends are accurate. No-op on the in-memory adapter. */
  async captureSnapshot(): Promise<{ ok: true; captured: boolean }> {
    const facts = await this.repo.getFacts('month');
    if (this.repo.captureMonthlySnapshot) { await this.repo.captureMonthlySnapshot(facts); return { ok: true, captured: true }; }
    return { ok: true, captured: false };
  }
}
