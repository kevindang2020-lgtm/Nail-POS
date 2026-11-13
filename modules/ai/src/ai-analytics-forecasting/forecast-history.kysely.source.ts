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
import type { AiForecastContext, AppointmentSeriesSource, RevenueSeriesSource, RevenueSourceTotals } from './ai-analytics-forecasting.dto';
import type { SeriesPoint } from './forecast-core';
import { addDays as addYmdDays } from '@aipowersalon/date-time';   // §87: one calendar helper

const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const addDays = (d: string, n: number) => addYmdDays(d, n);
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
  async getSalesTotals(ctx: AiForecastContext, from: string, to: string): Promise<RevenueSourceTotals> {
    if (!this.inner.getSalesTotals) throw new Error('revenue source has no report totals');
    return this.inner.getSalesTotals(ctx, from, to);
  }
}

// ── Extras (AI Analytics Forecasting 03): forecast-to-capacity inputs, read-only ─────────────────────────────────────────
// Scheduled technician minutes per salon-local date: a date override (technician_shift_overrides) wins over the weekly
// template (technician_schedules), the same precedence booking uses; lunch / override breaks are subtracted. Approved time off
// and overnight carry-over are NOT subtracted (said on the screen). The minutes one appointment takes are the average booked
// duration of this branch's non-cancelled appointments over the last 56 salon days. Nothing is written.
export interface ForecastCapacityDay { date: string; scheduledMinutes: number; technicians: number;
  /** extras AI Analytics Forecasting 20: minutes removed from the schedule by APPROVED time off / blocked time on that day */
  timeOffMinutes?: number; blockedMinutes?: number;
  /** extras AI Analytics Forecasting 20: the branch's most-booked services (last 56 days) that no technician working that day is approved for */
  uncoveredServices?: string[] }
export interface ForecastCapacityInputs { days: ForecastCapacityDay[]; avgAppointmentMinutes: number | null; durationSample: number; durationWindowDays: number;
  /** extras AI Analytics Forecasting 20: the services checked for skill coverage (most booked first) */
  topServices?: string[] }
/** extras AI Analytics Forecasting 20 — minutes of [a,b) that fall inside any of the windows (all in minutes from the day's local midnight). Pure. */
export function overlapMinutes(windows: [number, number][], a: number, b: number): number {
  return windows.reduce((t, [s, e]) => t + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);
}
/** working windows of one template row: [start, end) minus the lunch window */
function templateWindows(r: { start_time: unknown; end_time: unknown; lunch_start_time: unknown; lunch_end_time: unknown }): [number, number][] {
  const s = minutesOf(r.start_time), e = minutesOf(r.end_time); if (s == null || e == null || e <= s) return [];
  const ls = minutesOf(r.lunch_start_time), le = minutesOf(r.lunch_end_time);
  if (ls == null || le == null || le <= ls) return [[s, e]];
  return ([[s, Math.min(e, ls)], [Math.max(s, le), e]] as [number, number][]).filter(([a, b]) => b > a);
}
/** working windows of one override (overnight runs past 1440); breaks removed */
function overrideWindows(o: { override_type: string; start_local_time: unknown; end_local_time: unknown; ends_next_day: boolean; breaks_json: unknown }): [number, number][] {
  if (o.override_type !== 'CUSTOM_SHIFT') return [];
  const s = minutesOf(o.start_local_time), e0 = minutesOf(o.end_local_time); if (s == null || e0 == null) return [];
  const e = o.ends_next_day ? 1440 + e0 : e0;
  let w: [number, number][] = e > s ? [[s, e]] : [];
  for (const b of (Array.isArray(o.breaks_json) ? o.breaks_json : []) as { startLocalTime?: string; endLocalTime?: string }[]) {
    const bs = minutesOf(b?.startLocalTime), be0 = minutesOf(b?.endLocalTime); if (bs == null || be0 == null) continue;
    let bsA = bs, beA = be0 >= bs ? be0 : be0 + 1440;
    if (o.ends_next_day && bs < s) { bsA += 1440; beA += 1440; }   // a break after midnight of an overnight shift
    w = w.flatMap(([a, z]) => ([[a, Math.min(z, bsA)], [Math.max(a, beA), z]] as [number, number][]).filter(([x, y]) => y > x));
  }
  return w;
}
const minutesOf = (t: unknown): number | null => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const dowOf = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay();
/** working minutes of one override (DAY_OFF → 0; CUSTOM_SHIFT → its window minus its breaks; an overnight shift counts its full length) */
export function overrideMinutes(o: { override_type: string; start_local_time: unknown; end_local_time: unknown; ends_next_day: boolean; breaks_json: unknown }): number {
  if (o.override_type !== 'CUSTOM_SHIFT') return 0;
  const s = minutesOf(o.start_local_time), e = minutesOf(o.end_local_time);
  if (s == null || e == null) return 0;
  const span = o.ends_next_day ? 1440 - s + e : e - s;
  const breaks = (Array.isArray(o.breaks_json) ? o.breaks_json : []).reduce((a: number, b: { startLocalTime?: string; endLocalTime?: string }) => {
    const bs = minutesOf(b?.startLocalTime), be = minutesOf(b?.endLocalTime);
    return bs == null || be == null ? a : a + Math.max(0, be >= bs ? be - bs : 1440 - bs + be);
  }, 0);
  return Math.max(0, span - breaks);
}
export class ScheduleCapacitySource {
  constructor(private readonly db: Kysely<DB>, private readonly now: () => Date = () => new Date()) {}
  async getCapacity(ctx: AiForecastContext, dates: string[]): Promise<ForecastCapacityInputs> {
    const WINDOW = 56;
    if (!isUuid(ctx.branchId) || !dates.length) return { days: dates.map((d) => ({ date: d, scheduledMinutes: 0, technicians: 0 })), avgAppointmentMinutes: null, durationSample: 0, durationWindowDays: WINDOW };
    const templ = (await sql<{ technician_id: string; day_of_week: number; minutes: number; start_time: unknown; end_time: unknown; lunch_start_time: unknown; lunch_end_time: unknown }>`select s.technician_id, s.day_of_week,
        extract(epoch from (s.end_time - s.start_time)) / 60.0 - coalesce(extract(epoch from (s.lunch_end_time - s.lunch_start_time)) / 60.0, 0) as minutes,
        s.start_time::text as start_time, s.end_time::text as end_time, s.lunch_start_time::text as lunch_start_time, s.lunch_end_time::text as lunch_end_time
      from technician_schedules s join technicians t on t.id = s.technician_id and t.tenant_id = s.tenant_id
      where s.tenant_id = ${ctx.tenantId} and s.branch_id = ${ctx.branchId}::uuid and s.is_working = true and t.is_active = true and t.archived_at is null`.execute(this.db)).rows;
    const sorted = [...dates].sort();
    const ovr = (await sql<{ technician_id: string; d: string; override_type: string; start_local_time: unknown; end_local_time: unknown; ends_next_day: boolean; breaks_json: unknown }>`select o.technician_id, to_char(o.local_shift_date, 'YYYY-MM-DD') as d,
        o.override_type, o.start_local_time, o.end_local_time, o.ends_next_day, o.breaks_json
      from technician_shift_overrides o join technicians t on t.id = o.technician_id and t.tenant_id = o.tenant_id
      where o.tenant_id = ${ctx.tenantId} and o.branch_id = ${ctx.branchId}::uuid and t.is_active = true and t.archived_at is null
        and o.local_shift_date >= ${sorted[0]}::date and o.local_shift_date <= ${sorted[sorted.length - 1]}::date`.execute(this.db)).rows;
    // extras AI Analytics Forecasting 20: APPROVED time off (in the salon's local clock) and blocked time come off the schedule —
    // only the minutes that fall inside each technician's own working windows; technician skills are checked against the most
    // booked services. All read-only.
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
    const first = sorted[0], last = sorted[sorted.length - 1];
    const off = (await sql<{ technician_id: string; s: string; e: string }>`select o.technician_id, to_char(o.starts_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as s, to_char(o.ends_at at time zone ${tz}, 'YYYY-MM-DD HH24:MI') as e
      from technician_time_off o join technicians t on t.id = o.technician_id and t.tenant_id = o.tenant_id
      where o.tenant_id = ${ctx.tenantId} and (o.branch_id = ${ctx.branchId}::uuid or o.branch_id is null) and o.status = 'approved'
        and o.ends_at > (${first}::date)::timestamp at time zone ${tz} and o.starts_at < (${addDays(last, 1)}::date)::timestamp at time zone ${tz}`.execute(this.db)).rows;
    const blk = (await sql<{ technician_id: string; d: string; s: string; e: string }>`select b.technician_id, to_char(b.block_date, 'YYYY-MM-DD') as d, b.start_time::text as s, b.end_time::text as e
      from technician_blocked_times b where b.tenant_id = ${ctx.tenantId} and b.branch_id = ${ctx.branchId}::uuid and b.block_date >= ${first}::date and b.block_date <= ${last}::date`.execute(this.db)).rows;
    const dayIdx = (ymd: string) => Math.round(new Date(ymd + 'T00:00:00Z').getTime() / 86_400_000);
    const at = (local: string) => dayIdx(local.slice(0, 10)) * 1440 + (minutesOf(local.slice(11)) ?? 0);   // absolute local minutes
    const DAY_SVC_TOP = 5;
    const today0 = await salonToday(this.db, ctx, this.now());
    const top = (await sql<{ id: string; name: string }>`select sv.id, sv.name from pos_tech_appointments a
        cross join lateral jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) e
        join services sv on sv.tenant_id = a.tenant_id and sv.id::text = e->>'serviceId'
      where a.tenant_id = ${ctx.tenantId} and a.branch_id = ${ctx.branchId}::uuid and a.status not in ('cancelled', 'no_show') and a.appt_date >= ${addDays(today0, -WINDOW)}::date and a.appt_date < ${today0}::date
      group by sv.id, sv.name order by count(*) desc, sv.name asc limit ${DAY_SVC_TOP}`.execute(this.db)).rows;
    const quals = top.length ? (await sql<{ technician_id: string; service_id: string }>`select ts.technician_id, ts.service_id from technician_services ts
      where ts.tenant_id = ${ctx.tenantId} and ts.service_id = any(${top.map((x) => String(x.id))}::uuid[])`.execute(this.db)).rows : [];
    const days = dates.map((date) => {
      const win = new Map<string, [number, number][]>(); const per = new Map<string, number>();
      for (const r of templ) if (Number(r.day_of_week) === dowOf(date)) { const id = String(r.technician_id);
        per.set(id, (per.get(id) ?? 0) + Math.max(0, Number(r.minutes ?? 0))); win.set(id, [...(win.get(id) ?? []), ...templateWindows(r)]); }
      for (const o of ovr) if (o.d === date) { const id = String(o.technician_id); per.set(id, overrideMinutes(o)); win.set(id, overrideWindows(o)); }
      const base = dayIdx(date) * 1440; let timeOff = 0, blocked = 0;
      for (const [id, m] of per) {
        if (m <= 0) continue;
        const w = win.get(id) ?? [];
        const offMin = Math.min(m, off.filter((x) => String(x.technician_id) === id).reduce((t, x) => t + overlapMinutes(w, at(x.s) - base, at(x.e) - base), 0));
        const left = m - offMin;
        const blkMin = Math.min(left, blk.filter((x) => String(x.technician_id) === id && x.d === date).reduce((t, x) => t + overlapMinutes(w, minutesOf(x.s) ?? 0, minutesOf(x.e) ?? 0), 0));
        per.set(id, left - blkMin); timeOff += offMin; blocked += blkMin;
      }
      const workingIds = [...per.entries()].filter(([, m]) => m > 0).map(([id]) => id);
      const working = workingIds.map((id) => per.get(id) ?? 0);
      const uncovered = top.filter((sv) => !quals.some((q) => String(q.service_id) === String(sv.id) && workingIds.includes(String(q.technician_id)))).map((sv) => String(sv.name));
      return { date, scheduledMinutes: Math.round(working.reduce((a, m) => a + m, 0)), technicians: working.length, timeOffMinutes: Math.round(timeOff), blockedMinutes: Math.round(blocked), uncoveredServices: workingIds.length ? uncovered : [] };
    });
    const today = await salonToday(this.db, ctx, this.now());
    const dur = (await sql<{ n: number; avg: number | null }>`select count(*)::int as n, avg(duration_minutes)::float8 as avg from pos_tech_appointments
      where tenant_id = ${ctx.tenantId} and branch_id = ${ctx.branchId}::uuid and status <> 'cancelled' and duration_minutes > 0
        and appt_date >= ${addDays(today, -WINDOW)}::date and appt_date < ${today}::date`.execute(this.db)).rows[0];
    const n = Number(dur?.n ?? 0);
    return { days, avgAppointmentMinutes: n > 0 && dur?.avg != null ? Math.round(Number(dur.avg)) : null, durationSample: n, durationWindowDays: WINDOW, topServices: top.map((x) => String(x.name)) };
  }
}
