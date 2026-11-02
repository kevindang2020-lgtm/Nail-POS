// dashboard.repository.ts — data port for the Super-Admin dashboard + an honest in-memory adapter.
// The service composes the pure aggregator; this port supplies the raw per-tenant facts and the plan-price config.
// The Postgres (Kysely) adapter (facts from tenants + tenant_subscriptions; createdDaysAgo from created_at; usage from
// the usage source) is deferred. The in-memory adapter defaults to EMPTY so a DB-less deployment reports zeros, not
// fabricated platform metrics.
import type { PlatformTenantFact } from './dashboard.dto';

export interface DashboardDataPort {
  getFacts(): Promise<PlatformTenantFact[]>;
  getPlanPrices(): Promise<Record<string, number>>;
}

export interface DashboardSeed { facts: PlatformTenantFact[]; planPrices: Record<string, number> }

export class InMemoryDashboardRepository implements DashboardDataPort {
  constructor(private seed: DashboardSeed = { facts: [], planPrices: {} }) {}
  async getFacts(): Promise<PlatformTenantFact[]> { return this.seed.facts; }
  async getPlanPrices(): Promise<Record<string, number>> { return this.seed.planPrices; }
}
