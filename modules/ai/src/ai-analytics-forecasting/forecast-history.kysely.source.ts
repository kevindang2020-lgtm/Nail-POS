// forecast-history.kysely.source.ts — AI Analytics & Forecasting guide (Nov 1 2026): the appointment history the forecasts are
// trained on, read from the BOOKING CALENDAR (pos_tech_appointments — the same table no-show risk and busy periods read).
//
// Before this, the "appointments" series came from the sales report: the number of PAID tickets on each day that had a sale.
// Two consequences: (1) it measured completed sales, not appointments; (2) days without a sale were simply missing — so "have 9"
// counted days with sales, and the model saw a series with the quiet days cut out (a closed Monday and a salon that did no
// business both disappeared). Now: one point per salon-local day from the first booked day to YESTERDAY (today is not over),
// zero-filled, cancelled appointments excluded. Read-only; tenant + branch scoped.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import type { AiForecastContext, AppointmentSeriesSource, RevenueSeriesSource } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';

const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** the salon's "today" (YYYY-MM-DD) in its own time zone */
export async function salonToday(db: Kysely<DB>, ctx: { tenantId: string; branchId: string | null }, now = new Date()): Promise<string> {
  const tz = await branchTimeZone(db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
/** one point per day from `from` to `to` inclusive; days without data are 0 (a closed or quiet day, never missing) */
export function zeroFill(points: SeriesPoint[], from: string, to: string): SeriesPoint[] {
  if (from > to) return [];
  const by = new Map(points.map((p) => [p.date, p.value]));
  const out: SeriesPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, value: by.get(d) ?? 0 });
  return out;
}

export class BookingCalendarAppointmentSource implements AppointmentSeriesSource {
  constructor(private readonly db: Kysely<DB>, private readonly now: () => Date = () => new Date()) {}
  async getDailyAppointments(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]> {
    const today = await salonToday(this.db, ctx, this.now());
    const to = addDays(today, -1);
    const from = addDays(today, -Math.max(1, lookbackDays));
    const rows = (await sql<{ d: string; n: number }>`select to_char(appt_date, 'YYYY-MM-DD') as d, count(*)::int as n from pos_tech_appointments
      where tenant_id = ${ctx.tenantId} and ${isUuid(ctx.branchId) ? sql`branch_id = ${ctx.branchId}::uuid` : sql`true`} and status <> 'cancelled' and appt_date >= ${from}::date and appt_date <= ${to}::date
      group by appt_date order by appt_date`.execute(this.db)).rows;
    if (!rows.length) return [];
    // history starts at the first booked day in the window
    return zeroFill(rows.map((r) => ({ date: r.d, value: Number(r.n) })), rows[0].d, to);
  }
}

/** The revenue series stays on the canonical report (one revenue definition), but the gaps between sales days are zero days. */
export class ZeroFilledRevenueSource implements RevenueSeriesSource {
  constructor(private readonly inner: RevenueSeriesSource, private readonly db: Kysely<DB> | null, private readonly now: () => Date = () => new Date()) {}
  async getDailyRevenue(ctx: AiForecastContext, lookbackDays: number): Promise<SeriesPoint[]> {
    const pts = (await this.inner.getDailyRevenue(ctx, lookbackDays)).filter((p) => p && p.date).sort((a, b) => a.date.localeCompare(b.date));
    if (!pts.length) return [];
    const to = this.db ? addDays(await salonToday(this.db, ctx, this.now()), -1) : pts[pts.length - 1].date;
    return zeroFill(pts.filter((p) => p.date <= to), pts[0].date, to);
  }
}
