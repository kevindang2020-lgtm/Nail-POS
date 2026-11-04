// product-demand.kysely.source.ts — production demand source. Builds a gap-filled daily DEMAND series (retail_sale +
// service_usage units) for one product at the ctx branch from the ai_inventory movements ledger. A generate_series date
// spine ensures no-activity days count as 0 demand (so the forecaster sees a continuous series). Read-only; tenant+branch
// scoped. Validated against Postgres semantics.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import type { AiForecastContext, ProductDemandSource } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

export class KyselyProductDemandSource implements ProductDemandSource {
  constructor(private readonly db: Kysely<DB>) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  async getDailyDemand(ctx: AiForecastContext, productId: string, lookbackDays: number): Promise<SeriesPoint[]> {
    const days = Math.max(7, Math.min(365, lookbackDays));
    // the BRANCH's days (Oct 6 2026 — they were the database's UTC days: an evening sale in New York counted toward
    // tomorrow, and from 8 pm the series ended on a day that had not started here)
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);
    const today = sql`(${new Date(this.now())}::timestamptz at time zone ${tz})::date`;
    const rows = await sql<any>`
      WITH spine AS (
        SELECT generate_series((${today} - (${String(days)}::int - 1)), ${today}, interval '1 day')::date AS d
      )
      SELECT spine.d AS date,
             -- a recipe use records its exact amount in metadata (audit D9); a retail sale is whole units
             COALESCE(SUM(CASE WHEN m.movement_type = 'service_usage' THEN coalesce((m.metadata_json->>'quantityHundredths')::numeric / 100, -m.quantity_change) ELSE -m.quantity_change END), 0)::float AS demand
      FROM spine
      LEFT JOIN inventory_stock_movements m
        ON (m.created_at at time zone ${tz})::date = spine.d
       AND m.tenant_id = ${ctx.tenantId} AND m.branch_id = ${ctx.branchId} AND m.product_id = ${productId}
       AND m.movement_type IN ('retail_sale', 'service_usage')
      GROUP BY spine.d
      ORDER BY spine.d
    `.execute(this.db);
    return rows.rows.map((r): SeriesPoint => ({
      date: (r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10)),
      value: Math.max(0, Number(r.demand ?? 0)),
    }));
  }
}
