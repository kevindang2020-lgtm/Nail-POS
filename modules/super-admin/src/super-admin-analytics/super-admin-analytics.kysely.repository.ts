// super-admin-analytics.kysely.repository.ts — live cross-tenant queries that fill three previously-honest gaps in
// the platform Analytics page, derived entirely from REAL sources (payments, payments⋈branches). This is a Super
// Admin oversight surface (SuperAdminGuard, intentionally cross-tenant — path-allowlisted by the isolation guard).
// Every method is tenant-scopable via `sid`: when a scope is present the query is filtered to that tenant.
// Returns empty arrays when there is no data, so the service keeps an honest gap rather than inventing rows.

import type { DemandCell, StateRevenue, CategoryRevenue } from '@aipowersalon/api-contracts/platform';
export type { DemandCell, StateRevenue, CategoryRevenue };   // owned by packages/api-contracts (Constitution 13 §13)
import { quantile } from '@aipowersalon/observability';
import { MS_BUCKETS } from '@aipowersalon/observability';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export type DailyPoint = { day: string; revenueCents: number; transactions: number };
export type NewVsReturning = { newCount: number; returningCount: number };
export type TenantChurn = { suspendedWindow: number; activeNow: number; windowDays: number; churnRatePct: number };
export type RequestHealth = { total: number; serverErrors: number; apiSuccessPct: number; p50LatencyMs: number; p95LatencyMs: number; windowMinutes: number };

export interface AnalyticsGapRepo {
  dailySeries(sid: string | undefined, days: number): Promise<DailyPoint[]>;
  revenueByState(sid: string | undefined): Promise<StateRevenue[]>;
  demandMatrix(sid: string | undefined): Promise<DemandCell[]>;
  categoryRevenue(sid: string | undefined): Promise<CategoryRevenue[]>;
  newVsReturning(sid: string | undefined, days: number): Promise<NewVsReturning | null>;
  tenantChurn(days: number): Promise<TenantChurn | null>;
  requestHealth(windowMinutes: number): Promise<RequestHealth | null>;
}

const scoped = (qb: any, sid: string | undefined, col = 'tenant_id') => (sid ? qb.where(col, '=', sid) : qb);

export class KyselyAnalyticsGapRepo implements AnalyticsGapRepo {
  constructor(private readonly db: Kysely<DB>) {}

  // Daily revenue + approved transaction count for the last `days` days (captured/approved payments only).
  async dailySeries(sid: string | undefined, days: number): Promise<DailyPoint[]> {
    const rows: any[] = await scoped(
      (this.db as any).selectFrom('payments').where('is_test', '=', false).where('approved_at', 'is not', null)
        .where('created_at', '>=', sql`current_date - (${days - 1} || ' days')::interval`),
      sid,
    ).select([
      sql`to_char(created_at::date, 'YYYY-MM-DD')`.as('day'),
      sql`coalesce(sum(amount_cents),0)`.as('cents'),
      sql`count(*)`.as('txns'),
    ]).groupBy(sql`created_at::date`).orderBy(sql`created_at::date`).execute().catch(() => []);
    return rows.map((r) => ({ day: String(r.day), revenueCents: Number(r.cents || 0), transactions: Number(r.txns || 0) }));
  }

  // Revenue + transactions by US state (payments ⋈ branches.state). Branch carries the state.
  async revenueByState(sid: string | undefined): Promise<StateRevenue[]> {
    const rows: any[] = await scoped(
      (this.db as any).selectFrom('payments as p').innerJoin('branches as b', 'b.id', 'p.branch_id').where('p.is_test', '=', false)
        .where('p.approved_at', 'is not', null).where('b.state', 'is not', null),
      sid, 'p.tenant_id',
    ).select([
      'b.state as state',
      sql`coalesce(sum(p.amount_cents),0)`.as('cents'),
      sql`count(*)`.as('txns'),
    ]).groupBy('b.state').orderBy(sql`sum(p.amount_cents)`, 'desc').limit(50).execute().catch(() => []);
    return rows.filter((r) => r.state).map((r) => ({ state: String(r.state), revenueCents: Number(r.cents || 0), transactions: Number(r.txns || 0) }));
  }

  // Demand matrix: approved transaction counts by day-of-week (0=Sun) × hour-of-day.
  async demandMatrix(sid: string | undefined): Promise<DemandCell[]> {
    const rows: any[] = await scoped(
      (this.db as any).selectFrom('payments').where('is_test', '=', false).where('approved_at', 'is not', null),
      sid,
    ).select([
      sql`extract(dow from created_at)::int`.as('dow'),
      sql`extract(hour from created_at)::int`.as('hour'),
      sql`count(*)`.as('n'),
    ]).groupBy([sql`extract(dow from created_at)`, sql`extract(hour from created_at)`]).execute().catch(() => []);
    return rows.map((r) => ({ dow: Number(r.dow), hour: Number(r.hour), count: Number(r.n || 0) }));
  }

  // Billed revenue by service category (ticket_service_lines ⋈ services ⋈ service_categories). Category name
  // resolves to the current category, then the captured snapshot, then 'Uncategorized'. Removed lines excluded.
  async categoryRevenue(sid: string | undefined): Promise<CategoryRevenue[]> {
    const rows: any[] = await scoped(
      (this.db as any).selectFrom('ticket_service_lines as tsl')
        .leftJoin('services as s', 's.id', 'tsl.service_id')
        .leftJoin('service_categories as sc', 'sc.id', 's.category_id')
        .where('tsl.removed_at', 'is', null),
      sid, 'tsl.tenant_id',
    ).select([
      sql`coalesce(sc.name, tsl.category_snapshot, 'Uncategorized')`.as('category'),
      sql`coalesce(sum(tsl.line_total_cents),0)`.as('cents'),
      sql`count(*)`.as('lines'),
    ]).groupBy(sql`coalesce(sc.name, tsl.category_snapshot, 'Uncategorized')`).orderBy(sql`sum(tsl.line_total_cents)`, 'desc').limit(20).execute().catch(() => []);
    return rows.map((r) => ({ category: String(r.category), revenueCents: Number(r.cents || 0), lines: Number(r.lines || 0) }));
  }

  // New vs returning customers active in the last `days`, by first-visit date (first ticket). A customer whose
  // first-ever ticket falls inside the window is "new"; one whose first ticket predates it is "returning".
  async newVsReturning(sid: string | undefined, days: number): Promise<NewVsReturning | null> {
    const tenantFv = sid ? sql`where tenant_id = ${sid}` : sql``;
    const tenantWv = sid ? sql`and tenant_id = ${sid}` : sql``;
    const cutoff = sql`current_date - (${days - 1} || ' days')::interval`;
    try {
      const r: any = await sql<{ new_count: number; returning_count: number }>`
        with fv as (select customer_id, min(created_at) as first_at from tickets ${tenantFv} group by customer_id),
             wv as (select distinct customer_id from tickets where created_at >= ${cutoff} ${tenantWv})
        select coalesce(count(*) filter (where fv.first_at >= ${cutoff}),0)::int as new_count,
               coalesce(count(*) filter (where fv.first_at <  ${cutoff}),0)::int as returning_count
        from wv join fv on fv.customer_id = wv.customer_id
      `.execute(this.db as any);
      const row = r.rows?.[0];
      if (!row) return null;
      return { newCount: Number(row.new_count || 0), returningCount: Number(row.returning_count || 0) };
    } catch { return null; }
  }

  // Platform tenant churn: tenants suspended within the last `days` (real signal: tenants.suspended_at), and the
  // resulting churn rate against currently-active tenants. Platform-wide by nature (a single tenant doesn't churn).
  async tenantChurn(days: number): Promise<TenantChurn | null> {
    const cutoff = sql`current_date - (${days - 1} || ' days')::interval`;
    try {
      const r: any = await sql<{ suspended_window: number; active_now: number }>`
        select coalesce(count(*) filter (where suspended_at is not null and suspended_at >= ${cutoff}),0)::int as suspended_window,
               coalesce(count(*) filter (where status = 'active'),0)::int as active_now
        from tenants
      `.execute(this.db as any);
      const row = r.rows?.[0];
      if (!row) return null;
      const sw = Number(row.suspended_window || 0), an = Number(row.active_now || 0);
      return { suspendedWindow: sw, activeNow: an, windowDays: days, churnRatePct: Math.round((sw / Math.max(1, an + sw)) * 1000) / 10 };
    } catch { return null; }
  }

  // Platform API health over the last `windowMinutes`: API success rate (non-error responses) and p50/p95 latency,
  // Constitution 11 §246: from per-MINUTE aggregates (platform_request_metrics_minute, migration 443), not a row
  // per request. p50/p95 come from the summed latency histogram — the standard bucket interpolation, exact enough
  // for a dashboard and O(minutes × routes) instead of O(requests). Null when there is no telemetry in the window.
  async requestHealth(windowMinutes: number): Promise<RequestHealth | null> {
    const cutoff = sql`now() - (${windowMinutes} || ' minutes')::interval`;
    try {
      const r: any = await sql`
        select coalesce(sum(count),0)::int as total,
               coalesce(sum(count) filter (where status_class = 5),0)::int as server_errors,
               coalesce(sum(count) filter (where status_class in (2,3)),0)::int as ok,
               coalesce(sum(le_5),0)::int le_5, coalesce(sum(le_10),0)::int le_10, coalesce(sum(le_25),0)::int le_25,
               coalesce(sum(le_50),0)::int le_50, coalesce(sum(le_100),0)::int le_100, coalesce(sum(le_250),0)::int le_250,
               coalesce(sum(le_500),0)::int le_500, coalesce(sum(le_1000),0)::int le_1000, coalesce(sum(le_2500),0)::int le_2500,
               coalesce(sum(le_5000),0)::int le_5000, coalesce(sum(le_10000),0)::int le_10000, coalesce(sum(le_inf),0)::int le_inf
        from platform_request_metrics_minute where bucket_minute >= ${cutoff}
      `.execute(this.db as any);
      const row = r.rows?.[0];
      const total = Number(row?.total || 0);
      if (!row || total === 0) return null;
      const ok = Number(row.ok || 0);
      const h = { buckets: [...MS_BUCKETS], counts: ['le_5','le_10','le_25','le_50','le_100','le_250','le_500','le_1000','le_2500','le_5000','le_10000','le_inf'].map((c) => Number(row[c] || 0)), sum: 0, count: total };
      return {
        total, serverErrors: Number(row.server_errors || 0), apiSuccessPct: Math.round((ok / total) * 1000) / 10,
        p50LatencyMs: Math.round(quantile(h, 0.5) ?? 0), p95LatencyMs: Math.round(quantile(h, 0.95) ?? 0), windowMinutes,
      };
    } catch { return null; }
  }
}
