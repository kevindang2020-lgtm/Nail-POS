/**
 * overview.service.ts — POS Overview use-cases. Framework-free for testability.
 * Derives scope from the session TenantContext (never the client), calls the repo's
 * single scoped aggregate, and returns either the rich PosOverviewResponse (default,
 * what the screen renders) or the spec's flatter POSOverviewState projection.
 */
import {
  toPosOverviewState,
  type PosOverviewResponse,
  type POSOverviewState,
} from './overview.dto';
import type { OverviewRepo, OverviewScope, OverviewQuery } from './overview.repository';
import type { TenantCache } from '@aipowersalon/cache';
import { isStaffPrincipal } from '@aipowersalon/permissions';   // BUILD_PLAN Phase 9: the plane check, one place

export interface TenantContext {
  tenantId: string;
  branchId: string | null;
  userId: string;
  role: string;
  permissions: string[];
}

// Roles that must never read the tenant POS overview (defense-in-depth behind the guards).

// The overview aggregate (KPIs, revenue trend, top services/techs, payment mix, insights) is a heavy analytical read
// that every slice endpoint projects from — a prime short-TTL cache target. The live board feeds are a SEPARATE
// service (OverviewBoardService, realtime bus) and are intentionally NOT cached here. TTL is short so the numbers
// self-heal within seconds. Key = tenant+branch (by the cache) + query shape.
const OVERVIEW_CACHE_TTL_SECONDS = 30;

export class OverviewService {
  constructor(private readonly repo: OverviewRepo, private readonly cache?: TenantCache) {}

  private scope(tc: TenantContext): OverviewScope {
    if (!isStaffPrincipal(tc)) throw new Error('forbidden_pos_overview');
    return { tenantId: tc.tenantId, branchId: tc.branchId }; // server-side only
  }

  // Read-through the aggregate. Every getState/getSummary/slice call funnels through here, so one cached aggregate
  // serves them all within the TTL. Passthrough (calls the repo) when no cache is configured.
  private aggregate(tc: TenantContext, q: OverviewQuery): Promise<PosOverviewResponse> {
    const scope = this.scope(tc);
    if (!this.cache) return this.repo.getAggregate(scope, q);
    const key = 'overview:state:' + JSON.stringify(q ?? {});
    return this.cache.getOrSet({ tenantId: tc.tenantId, branchId: tc.branchId ?? undefined }, key, OVERVIEW_CACHE_TTL_SECONDS, () => this.repo.getAggregate(scope, q));
  }

  /** GET /pos/overview/state — the raw nested aggregate. The POS Overview screen consumes the flat
   *  POSOverviewState projection via ?shape=summary (getSummary); this raw shape is for API consumers. */
  getState(tc: TenantContext, q: OverviewQuery = {}): Promise<PosOverviewResponse> {
    return this.aggregate(tc, q);
  }

  /** GET /pos/overview/state?shape=summary — spec §8 flat projection. */
  async getSummary(tc: TenantContext, q: OverviewQuery = {}): Promise<POSOverviewState> {
    return toPosOverviewState(await this.aggregate(tc, q));
  }

  // --- §9 slice endpoints: each a projection of the same aggregate (no duplicate queries) ---
  async getKpis(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getSummary(tc, q)).kpis;
  }
  async getTodaySummary(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getSummary(tc, q)).todaySummary;
  }
  async getRevenueTrend(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getState(tc, q)).analytics.revenueTrend;
  }
  async getTopServices(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getState(tc, q)).analytics.topServices;
  }
  async getTopTechnicians(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getState(tc, q)).analytics.topTechnicians;
  }
  async getPaymentMix(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getSummary(tc, q)).paymentMix;
  }
  async getInsights(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getSummary(tc, q)).insights;
  }
  async getAlerts(tc: TenantContext, q: OverviewQuery = {}) {
    return (await this.getSummary(tc, q)).alerts;
  }
}
