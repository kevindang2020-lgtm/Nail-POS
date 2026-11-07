// tech-metrics.ts — F5 §73 (Nov 6 2026): ONE technician metrics surface for Today / This week / This month, salon-local.
//
//   clockedMinutes  time on the clock (technician_shifts start → end; an open shift counts up to now)
//   breakMinutes    breaks inside those shifts (technician_breaks; an open break counts up to now)
//   serviceMinutes  minutes of completed services the technician did (ticket_service_lines on settled / service-done tickets)
//   readyMinutes    clocked − breaks − services, never below 0 (time available for the next guest)
//   turnUnits       net turn units from the turn ledger (technician_turn_events.turn_units_delta)
//   services        completed service lines
//
// Each number is read from its own authority; nothing is estimated. A source that cannot be read is null (never a 0).
import { sql, type Kysely } from 'kysely';
import { branchTimeZone } from '@aipowersalon/database';

export const TECH_METRIC_PERIODS = ['today', 'week', 'month'] as const;
export type TechMetricPeriod = (typeof TECH_METRIC_PERIODS)[number];
export interface TechMetrics {
  period: TechMetricPeriod; from: string; to: string; timezone: string;
  clockedMinutes: number | null; breakMinutes: number | null; serviceMinutes: number | null; readyMinutes: number | null;
  turnUnits: number | null; services: number | null;
}
const N = (v: unknown) => Number(v ?? 0) || 0;

export async function loadTechMetrics(db: Kysely<any>, scope: { tenantId: string; branchId?: string | null }, technicianId: string, period: TechMetricPeriod, nowMs = Date.now()): Promise<TechMetrics> {
  const tz = await branchTimeZone(db, scope.tenantId, scope.branchId ?? null, nowMs);
  const now = new Date(nowMs).toISOString();
  // the salon-local period start: today 00:00, Monday 00:00, the 1st 00:00
  const w: { from: string; to: string } = (await sql<{ from: string; to: string }>`select to_char(d, 'YYYY-MM-DD') as "from", to_char((${now}::timestamptz at time zone ${tz})::date, 'YYYY-MM-DD') as "to"
    from (select case ${period} when 'today' then (${now}::timestamptz at time zone ${tz})::date
      when 'week' then date_trunc('week', (${now}::timestamptz at time zone ${tz}))::date
      else date_trunc('month', (${now}::timestamptz at time zone ${tz}))::date end as d) x`.execute(db)).rows[0];
  const lo = sql`(${w.from}::date::timestamp at time zone ${tz})`, hi = sql`${now}::timestamptz`;
  const T = scope.tenantId;
  const safe = async (fn: () => Promise<number>) => { try { return await fn(); } catch (e) { void e; return null; } };   // unreadable source → null, never 0
  const clocked = await safe(async () => N((await sql<any>`select coalesce(sum(extract(epoch from (least(coalesce(s.end_time, ${hi}), ${hi}) - greatest(s.start_time, ${lo}))) / 60), 0)::int as m
    from technician_shifts s where s.tenant_id = ${T} and s.technician_id = ${technicianId} and s.start_time < ${hi} and coalesce(s.end_time, ${hi}) > ${lo}`.execute(db)).rows[0]?.m));
  const breaks = await safe(async () => N((await sql<any>`select coalesce(sum(extract(epoch from (least(coalesce(b.ended_at, ${hi}), ${hi}) - greatest(b.started_at, ${lo}))) / 60), 0)::int as m
    from technician_breaks b where b.tenant_id = ${T} and b.technician_id = ${technicianId} and b.started_at < ${hi} and coalesce(b.ended_at, ${hi}) > ${lo}`.execute(db)).rows[0]?.m));
  const svc = await (async () => { try {
    const r = (await sql<any>`select count(*)::int as n, coalesce(sum(l.duration_minutes_snapshot), 0)::int as m from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.technician_id = ${technicianId} and l.removed_at is null and t.removed_at is null and t.status in ('service_done', 'paid', 'closed')
        and coalesce(t.service_done_at, t.paid_at, t.created_at) >= ${lo} and coalesce(t.service_done_at, t.paid_at, t.created_at) < ${hi}`.execute(db)).rows[0];
    return { n: N(r?.n), m: N(r?.m) }; } catch (e) { void e; return null; } })();
  const turns = await safe(async () => N((await sql<any>`select coalesce(sum(e.turn_units_delta), 0)::int as u from technician_turn_events e
    where e.tenant_id = ${T} and e.technician_id = ${technicianId} and e.business_date >= ${w.from}::date and e.business_date <= ${w.to}::date`.execute(db)).rows[0]?.u));
  const ready = clocked == null || breaks == null || svc == null ? null : Math.max(0, clocked - breaks - svc.m);
  return { period, from: w.from, to: w.to, timezone: tz, clockedMinutes: clocked, breakMinutes: breaks, serviceMinutes: svc?.m ?? null, readyMinutes: ready, turnUnits: turns, services: svc?.n ?? null };
}
