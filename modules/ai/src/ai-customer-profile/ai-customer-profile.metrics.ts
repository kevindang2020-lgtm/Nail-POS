// ai-customer-profile.metrics.ts — tenant-scoped usage metering (spec §58). Counts summaries generated, churn/dedup
// evaluations, merges, recommendations, permission denials, and cross-tenant/disabled protections — the inputs the
// Super Admin "AI Usage" surface aggregates. The default impl is in-process; a Redis/StatsD-backed impl (for
// cross-instance platform totals) plugs in behind the same port. Labels are never raw high-cardinality values.
export interface ProfileMetrics {
  incr(tenantId: string, name: string, n?: number): void;
  snapshot(tenantId: string): Promise<Record<string, number>> | Record<string, number>;
}

/** In-process counters. Per-tenant map of name → count. Fine for a single node; swap for Redis at platform scale. */
export class InMemoryProfileMetrics implements ProfileMetrics {
  private readonly counts = new Map<string, Map<string, number>>();
  incr(tenantId: string, name: string, n = 1): void {
    if (!tenantId || !name) return;
    let t = this.counts.get(tenantId);
    if (!t) { t = new Map(); this.counts.set(tenantId, t); }
    t.set(name, (t.get(name) ?? 0) + n);
  }
  snapshot(tenantId: string): Record<string, number> {
    const t = this.counts.get(tenantId);
    return t ? Object.fromEntries(t) : {};
  }
}

/** Maps an audited action to its usage-metric name (§58 categories). Unknown actions fall through unchanged. */
export const METRIC_FOR_ACTION: Record<string, string> = {
  ai_profile_overview_viewed: 'summaries_generated',
  ai_profile_visit_summary_viewed: 'summaries_generated',
  ai_profile_service_prefs_viewed: 'preference_calculations',
  ai_profile_tech_pref_viewed: 'preference_calculations',
  ai_profile_inactivity_viewed: 'inactivity_detections',
  ai_profile_churn_viewed: 'churn_evaluations',
  ai_profile_duplicates_viewed: 'duplicate_scans',
  ai_profile_recommendations_viewed: 'service_recommendations',
  ai_profile_rebooking_viewed: 'rebooking_opportunities',
  ai_profile_timeline_viewed: 'timelines_built',
  ai_profile_merge_previewed: 'merge_previews',
  ai_profile_merge_executed: 'merges_executed',
  ai_profile_settings_updated: 'settings_changes',
};

// ---- cross-instance Redis sink (mirrors cache-redis) ----
// Per-tenant usage lives in a Redis hash keyed by tenant; HINCRBY is atomic, so counts from every API node aggregate
// into one truth that the Super Admin usage drill-down reads. Redis is abstracted behind MetricsRedis so it's
// unit-tested with an in-memory fake (two RedisProfileMetrics sharing one fake = two nodes). makeMetricsRedis wires ioredis.
export interface MetricsRedis {
  hincrby(key: string, field: string, n: number): Promise<unknown> | unknown;
  hgetall(key: string): Promise<Record<string, string>> | Record<string, string>;
}

export class RedisProfileMetrics implements ProfileMetrics {
  private readonly prefix: string;
  constructor(private readonly redis: MetricsRedis, opts: { prefix?: string } = {}) { this.prefix = opts.prefix ?? 'aps:cache:'; }
  private key(tenantId: string): string { return `${this.prefix}acp:usage:${tenantId}`; }
  incr(tenantId: string, name: string, n = 1): void {
    if (!tenantId || !name) return;
    void Promise.resolve(this.redis.hincrby(this.key(tenantId), name, n)).catch(() => {}); // fire-and-forget; never break a read
  }
  async snapshot(tenantId: string): Promise<Record<string, number>> {
    const h = (await this.redis.hgetall(this.key(tenantId))) || {};
    const out: Record<string, number> = {};
    for (const k of Object.keys(h)) out[k] = Number((h as any)[k]);
    return out;
  }
}

// In-memory fake of the MetricsRedis primitives — simulates ONE shared Redis behind multiple nodes.
export class FakeMetricsRedis implements MetricsRedis {
  private m = new Map<string, Map<string, number>>();
  hincrby(key: string, field: string, n: number) { let h = this.m.get(key); if (!h) { h = new Map(); this.m.set(key, h); } h.set(field, (h.get(field) ?? 0) + n); }
  hgetall(key: string) { const h = this.m.get(key); const o: Record<string, string> = {}; if (h) for (const [k, v] of h) o[k] = String(v); return o; }
}

/** Wire a real ioredis client into the MetricsRedis port. Call only when REDIS_URL is set. */
export function makeMetricsRedis(client: { hincrby: (k: string, f: string, n: number) => Promise<unknown>; hgetall: (k: string) => Promise<Record<string, string>> }): MetricsRedis {
  return { hincrby: (k, f, n) => client.hincrby(k, f, n), hgetall: (k) => client.hgetall(k) };
}
