// busy-period.kysely.source.ts — production hour-of-week demand source. Aggregates booked (non-cancelled) appointments by
// weekday + hour for the ctx branch and normalizes each cell by how many of that weekday occurred in the window, giving
// "average bookings per that weekday-hour". Read-only; tenant+branch scoped. Validated against Postgres semantics.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiForecastContext, HourlyDemandSource } from './ai-analytics-forecasting.dto';
import type { HourCellInput } from './busy-period.core';

export class KyselyHourlyDemandSource implements HourlyDemandSource {
  constructor(private readonly db: Kysely<DB>) {}

  async getHourOfWeekDemand(ctx: AiForecastContext, lookbackDays: number): Promise<HourCellInput[]> {
    const days = Math.max(28, Math.min(365, lookbackDays));
    const rows = await sql<any>`
      WITH dow_days AS (
        SELECT EXTRACT(DOW FROM appt_date)::int AS dow, count(DISTINCT appt_date) AS d
        FROM pos_tech_appointments
        WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}
          AND status <> 'cancelled' AND appt_date >= (now() - (${String(days)} || ' days')::interval)::date
        GROUP BY 1
      )
      SELECT EXTRACT(DOW FROM a.appt_date)::int AS dow,
             EXTRACT(HOUR FROM a.start_time::time)::int AS hour,
             count(*)::int AS cnt,
             dd.d AS dow_days
      FROM pos_tech_appointments a
      JOIN dow_days dd ON dd.dow = EXTRACT(DOW FROM a.appt_date)::int
      WHERE a.tenant_id = ${ctx.tenantId} AND a.branch_id = ${ctx.branchId}
        AND a.status <> 'cancelled' AND a.appt_date >= (now() - (${String(days)} || ' days')::interval)::date
      GROUP BY 1, 2, dd.d
      ORDER BY 1, 2`.execute(this.db);
    return rows.rows.map((r): HourCellInput => {
      const occurrences = Number(r.dow_days) || 1;
      const samples = Number(r.cnt) || 0;
      return { dow: Number(r.dow), hour: Number(r.hour), samples, occurrences, avg: samples / occurrences };
    });
  }
}
