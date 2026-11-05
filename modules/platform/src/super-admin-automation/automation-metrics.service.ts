// automation-metrics.service.ts — real metric feeders for threshold-based rules. Each feeder queries actual platform
// data for the rule's scope over a rolling window and returns the metric payload the rule's own conditions evaluate
// (metric here, threshold in the rule config). Returns null when the sample is too small to judge (spec §41: minimum
// sample size) so a thin window never trips a threshold. Read-only; no fabricated values.
import { sql, type Kysely } from 'kysely';

export interface MetricRule { id: string; triggerId: string; tenantId: string | null }
const WINDOW_DAYS = 7;
const MIN_TXN_SAMPLE = 100;   // don't evaluate a chargeback rate on fewer than this many transactions

export class AutomationMetricsService {
  constructor(private readonly db: Kysely<any> | null) {}

  /** Chargeback rate/volume over the rolling window for a rule's scope. null ⇒ insufficient sample (do not fire). */
  async chargebackMetric(tenantId: string | null): Promise<Record<string, unknown> | null> {
    if (!this.db) return null;
    const scope = tenantId ? sql`and tenant_id = ${tenantId}` : sql``;
    const cb = await sql<any>`select count(*)::int c, coalesce(sum(amount_cents),0)::bigint cents from chargebacks where created_at >= now() - (${WINDOW_DAYS} || ' days')::interval ${scope}`.execute(this.db);
    const tx = await sql<any>`select count(*)::int c from payments where status = 'approved' and created_at >= now() - (${WINDOW_DAYS} || ' days')::interval ${scope}`.execute(this.db);
    const count = Number(cb.rows[0]?.c ?? 0);
    const txnCount = Number(tx.rows[0]?.c ?? 0);
    if (txnCount < MIN_TXN_SAMPLE) return null;                    // too few transactions to judge a rate honestly
    const rate = Math.round((count / txnCount) * 10000) / 100;      // percent, 2dp
    return { rate, count, txnCount, windowDays: WINDOW_DAYS, amountCents: Number(cb.rows[0]?.cents ?? 0) };
  }

  /** Highest plan-limit utilisation for a tenant (used ÷ limit across metered features). null ⇒ no usable limit rows. */
  async planLimitMetric(tenantId: string | null): Promise<Record<string, unknown> | null> {
    if (!this.db || !tenantId) return null;   // plan usage is a per-tenant concept
    const r = await sql<any>`
      select metric, used_value, limit_value,
             round((used_value::numeric / nullif(limit_value,0)) * 100, 1) as pct
      from tenant_usage_limits where tenant_id = ${tenantId} and limit_value > 0
      order by pct desc nulls last limit 1`.execute(this.db);
    const row = r.rows[0];
    if (!row) return null;
    return { usagePct: Number(row.pct ?? 0), metric: String(row.metric), used: Number(row.used_value), limit: Number(row.limit_value) };
  }

  /** Longest current device-offline duration (minutes) for a scope, from real last_seen heartbeats. null ⇒ no devices. */
  async deviceOfflineMetric(tenantId: string | null): Promise<Record<string, unknown> | null> {
    if (!this.db) return null;
    const scope = tenantId ? sql`and tenant_id = ${tenantId}` : sql``;
    const r = await sql<any>`
      select coalesce(max(extract(epoch from (now() - last_seen_at)) / 60), 0)::int as offline_minutes, count(*)::int as devices
      from device_sessions where last_seen_at is not null ${scope}`.execute(this.db);
    const row = r.rows[0];
    if (!row || Number(row.devices) === 0) return null;
    return { offlineMinutes: Number(row.offline_minutes), devices: Number(row.devices) };
  }

  /** Dispatch a due threshold rule to its metric feeder. Unknown/unfed triggers ⇒ null (schedule advances, no fire). */
  provider(): (rule: MetricRule) => Promise<Record<string, unknown> | null> {
    return async (rule: MetricRule) => {
      switch (rule.triggerId) {
        case 'CHARGEBACK_THRESHOLD_EXCEEDED': return this.chargebackMetric(rule.tenantId);
        case 'BRANCH_PLAN_LIMIT_REACHED': return this.planLimitMetric(rule.tenantId);
        case 'DEVICE_OFFLINE_DURATION_REACHED': return this.deviceOfflineMetric(rule.tenantId);
        default: return null;
      }
    };
  }
}
