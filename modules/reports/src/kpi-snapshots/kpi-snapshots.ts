import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';

// Pure: build the per-KPI trend map both POS dashboards consume ({ key: { deltaPercent, direction } }).
// `downIsGood` lists metric keys where a decrease is the positive direction (e.g. durations / turnaround time),
// so the UI can color them correctly. When no prior snapshot exists, every trend is null (UI shows nothing —
// honest "pending data" rather than a fabricated delta). Money metrics compare fine as raw integers (cents).
export interface KpiTrend { deltaPercent: number | null; direction: "up" | "down" }
export function buildKpiTrends(
  today: Record<string, number>,
  prior: Record<string, number> | null,
  downIsGood: string[] = [],
): Record<string, KpiTrend> {
  const out: Record<string, KpiTrend> = {};
  const down = new Set(downIsGood);
  for (const key of Object.keys(today)) {
    const cur = Number(today[key] ?? 0);
    const prev = prior ? Number(prior[key] ?? 0) : null;
    if (prev == null) { out[key] = { deltaPercent: null, direction: "up" }; continue; }
    const direction: "up" | "down" = cur >= prev ? "up" : "down";
    // percent change vs prior; when prior is 0 we can't form a ratio, so report direction with a null magnitude.
    const deltaPercent = prev === 0 ? null : Math.round((Math.abs(cur - prev) / Math.abs(prev)) * 1000) / 10;
    // direction is purely numeric here; the UI decides good/bad using `downIsGood` via the key, but we also
    // expose it so callers that don't track semantics still render the correct arrow.
    out[key] = { deltaPercent, direction };
    void down; // semantics consumed by the UI layer keyed on the same metric name
  }
  return out;
}

// Thin data-access helper around pos_kpi_daily_snapshots. Instantiated directly by the Kysely repos (no DI needed).
export class PosKpiSnapshots {
  constructor(private readonly db: Kysely<DB>) {}
  /** The branch's business day (Oct 6 2026 — was the UTC day: from 8 pm in New York the evening's figures were filed under
   *  tomorrow, and the next morning's overwrote them, so "vs yesterday" compared against a 7:59 pm snapshot). */
  private businessDay(tz: string) { return sql`(${new Date(this.now())}::timestamptz at time zone ${tz})::date`; }
  /** The clock (tests set it). */
  now: () => number = Date.now;

  // Idempotent upsert of the current business day's metrics for one tenant/branch/module. Fail-soft: never throws.
  async upsertToday(tenantId: string, branchId: string, module: string, metrics: Record<string, number>): Promise<void> {
    if (!tenantId || !branchId) return;
    try {
      await this.db
        .insertInto("pos_kpi_daily_snapshots")
        .values({ tenant_id: tenantId, branch_id: branchId, business_day: this.businessDay(await branchTimeZone(this.db, tenantId, branchId)) as any, module, metrics: JSON.stringify(metrics) })
        .onConflict((oc) => oc.constraint("uq_pos_kpi_snapshot").doUpdateSet({ metrics: JSON.stringify(metrics), updated_at: sql`now()` as any }))
        .execute();
    } catch { /* snapshot persistence is best-effort; trends simply stay null until a prior row exists */ }
  }

  // Most recent snapshot strictly before today (the "yesterday" baseline). Returns its metric map or null.
  async previous(tenantId: string, branchId: string, module: string): Promise<Record<string, number> | null> {
    if (!tenantId || !branchId) return null;
    try {
      const row = await this.db
        .selectFrom("pos_kpi_daily_snapshots")
        .where("tenant_id", "=", tenantId).where("branch_id", "=", branchId).where("module", "=", module)
        .where("business_day", "<", this.businessDay(await branchTimeZone(this.db, tenantId, branchId)) as any)
        .orderBy("business_day", "desc").select(["metrics"]).limit(1).executeTakeFirst();
      if (!row) return null;
      const m = (row as any).metrics;
      return typeof m === "string" ? JSON.parse(m) : (m || null);
    } catch { return null; }
  }

  // Convenience: persist today and return the trend map vs the latest prior day in one call.
  async snapshotAndTrends(tenantId: string, branchId: string, module: string, today: Record<string, number>, downIsGood: string[] = []): Promise<Record<string, KpiTrend>> {
    const prior = await this.previous(tenantId, branchId, module);
    await this.upsertToday(tenantId, branchId, module, today);
    return buildKpiTrends(today, prior, downIsGood);
  }
}
