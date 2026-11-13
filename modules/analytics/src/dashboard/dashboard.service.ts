/**
 * dashboard.service.ts — POS Dashboard use-cases. Framework-free for testability.
 * Derives scope from the session TenantContext (never the client), calls the repo's
 * scoped aggregate, and returns either the rich POSDashboardState (default) or the
 * spec's flat POSDashboardSummary projection (?shape=summary + slice endpoints).
 */
import {
  toPosDashboardSummary,
  type POSDashboardState,
  type POSDashboardSummary,
  type RevenueTrend,
  type TopService,
  type PaymentMix,
} from './dashboard.dto';
import type { DashboardRepo, DashboardScope, DashboardQuery } from './dashboard.repository';
import type { TenantCache } from '@aipowersalon/cache';
import { isStaffPrincipal } from '@aipowersalon/permissions';   // BUILD_PLAN Phase 9: the plane check, one place

export interface TenantContext {
  tenantId: string;
  branchId: string | null;
  userId: string;
  role: string;
  permissions: string[];
  /** Live Operations mandate §24 (Oct 28 2026): the branches this person may see (request authz; null = every branch) —
   *  the Multi-Location Snapshot lists only these */
  branchIds?: string[] | null;
}


// Dashboard aggregates are a heavy, staleness-tolerant read (they summarize the day's activity for a KPI screen), so
// they are a prime read-through-cache target. TTL is deliberately short so the board self-heals within seconds even
// without explicit invalidation. The cache key is derived from tenant+branch (by the cache) plus the query shape.
const DASHBOARD_CACHE_TTL_SECONDS = 30;

export class DashboardService {
  constructor(private readonly repo: DashboardRepo, private readonly cache?: TenantCache) {}

  private scope(tc: TenantContext): DashboardScope {
    if (!isStaffPrincipal(tc)) throw new Error('forbidden_pos_dashboard');
    return { tenantId: tc.tenantId, branchId: tc.branchId, branchIds: tc.branchIds ?? null };
  }

  // Read-through the aggregate. When no cache is configured this simply calls the repo (NoopTenantCache passthrough).
  private aggregate(tc: TenantContext, q: DashboardQuery): Promise<POSDashboardState> {
    const scope = this.scope(tc);
    if (!this.cache) return this.repo.getAggregate(scope, q);
    // the visible-branch set is part of the answer (Multi-Location Snapshot), so it is part of the key — two people at the
    // same branch with different branch grants never share a cached snapshot
    const key = 'dashboard:state:' + JSON.stringify(q ?? {}) + (scope.branchIds ? ':b=' + [...scope.branchIds].sort().join(',') : '');
    return this.cache.getOrSet({ tenantId: tc.tenantId, branchId: tc.branchId ?? undefined }, key, DASHBOARD_CACHE_TTL_SECONDS, () => this.repo.getAggregate(scope, q));
  }

  /** GET /pos/dashboard/state — rich aggregate (screen default). */
  getState(tc: TenantContext, q: DashboardQuery = {}): Promise<POSDashboardState> {
    return this.aggregate(tc, q);
  }

  /** GET /pos/dashboard/state?shape=summary — flat spec §8 projection. */
  async getSummary(tc: TenantContext, q: DashboardQuery = {}): Promise<POSDashboardSummary> {
    return toPosDashboardSummary(await this.aggregate(tc, q));
  }

  // --- §9 slice endpoints: projections of the same aggregate (no duplicate queries) ---
  async getKpis(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).kpis; }
  async getOperations(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).operations; }
  async getAppointments(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).appointments; }
  async getQueue(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).queue; }
  async getServing(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).serving; }
  async getCheckout(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).checkout; }
  // The three period slices the Live Operations card dropdowns read (Today / This Week / This Month) return the card's OWN
  // shape from the rich aggregate — they returned the flat summary projection ({points} / {items} / {cardPercent…}), which the
  // card cannot draw, so picking a period emptied the trend chart and broke the services / payment-mix donuts (Nov 2026).
  async getRevenueTrend(tc: TenantContext, q: DashboardQuery = {}): Promise<RevenueTrend> { return (await this.aggregate(tc, q)).revenueTrend; }
  async getTopServices(tc: TenantContext, q: DashboardQuery = {}): Promise<TopService[]> { return (await this.aggregate(tc, q)).topServices; }
  async getTopTechnicians(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).topTechnicians; }
  async getPaymentMix(tc: TenantContext, q: DashboardQuery = {}): Promise<PaymentMix> { return (await this.aggregate(tc, q)).paymentMix; }
  async getCustomers(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).customers; }
  async getInsights(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).insights; }
  async getAlerts(tc: TenantContext, q: DashboardQuery = {}) { return (await this.getSummary(tc, q)).alerts; }
}
