// live-schedule-screen.repository.ts — the read model behind the rebuilt Live Technician Schedule (/technicians/schedule,
// Oct 30 2026). The board itself stays on the canonical LiveTechnicianScheduleController (state / week / live-detail);
// this adds what the guide asks for and that board did not have: the six KPIs with written definitions for ONE salon day,
// one universal search (technicians AND appointments), the schedule activity history (newest first) and the impact of a
// weekly-shift change on booked appointments BEFORE it is saved. Read only — every write stays on its existing route.
//
// The six KPIs (ONE salon day D):
//   working today   active accounts with a published shift on D (technician_shifts, not cancelled) or, with none, a weekly
//                   working day (technician_schedules) — and no approved time off covering the whole of D. PLANNED, not
//                   attendance: clocked in is reported beside it.
//   available now   only when D is today: clocked in, queue AVAILABLE, not manually unavailable, no service in progress
//   in service      only when D is today: distinct technicians with an in-service appointment or queue SERVING
//   on break/lunch  only when D is today: an ACTIVE break (clock ON_BREAK / queue BREAK) — a lunch later today is not a break
//   booked hours    the duration of D's appointments that are not cancelled / no-show (completed included), real minutes
//   utilization     booked minutes ÷ scheduled minutes (shift length minus the weekly lunch) of the technicians working D;
//                   null (N/A) with no scheduled minutes. A forecast for today / a future day, booked work for a past day.
// For a past or future day the three live counts are null: a past date never advertises "Available Now".
import { sql, type Kysely } from 'kysely';
import { N, iso, like, paging, served, branchOf, teamPeriod, inPeriod, minuteOf, UUID, err, type TeamCtx } from './screen-kit';
import { TechniciansScreenRepository } from './technicians-screen.repository';
import { TechAppointmentsScreenRepository } from './tech-appointments-screen.repository';
import { dateColumnYmd } from '@aipowersalon/date-time';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const ACTIVE = ['confirmed', 'booked', 'scheduled', 'pending', 'arrived', 'checked_in', 'waiting', 'assigned', 'in_service'];
export const ACTIVITY_KINDS = ['all', 'booking', 'status', 'break', 'time_off', 'blocked', 'schedule'] as const;
const ymd = (v: unknown) => dateColumnYmd(v);   // a Postgres DATE column (the driver's local-midnight Date) → its calendar day

export class LiveScheduleScreenRepository {
  private readonly techs: TechniciansScreenRepository; private readonly appts: TechAppointmentsScreenRepository;
  constructor(private readonly db: Kysely<any>) { this.techs = new TechniciansScreenRepository(db); this.appts = new TechAppointmentsScreenRepository(db); }
  private br(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(te.branch_id = ${b} or te.branch_id is null)` : sql`true`; }
  private brA(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(a.branch_id = ${b} or a.branch_id is null)` : sql`true`; }
  private async day(ctx: TeamCtx, date?: string) { const p = await teamPeriod(this.db, ctx, { preset: 'today' }); const d = date && YMD.test(date) ? date : p.today; return { ...p, date: d, when: d < p.today ? 'past' : d > p.today ? 'future' : 'today' }; }

  async kpis(ctx: TeamCtx, q: { date?: string }) {
    const T = ctx.tenantId; const d = await this.day(ctx, q.date);
    // per active technician: the planned minutes of D (F4: a date override wins, then a published shift, then the weekly
    // schedule; breaks / lunch come off)
    const r = (await sql<any>`with planned as (
        select te.id,
          coalesce((select case when o.override_type = 'DAY_OFF' then 0 else extract(epoch from (o.end_local_time - o.start_local_time)) / 60 + case when o.ends_next_day then 1440 else 0 end
                - coalesce((select sum(extract(epoch from ((bk->>'endLocalTime')::time - (bk->>'startLocalTime')::time)) / 60) from jsonb_array_elements(o.breaks_json) bk), 0) end
              from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = te.id and o.local_shift_date = ${d.date}::date and (${branchOf(ctx)}::uuid is null or o.branch_id = ${branchOf(ctx)}) limit 1),
            (select sum(extract(epoch from (sh.end_time - sh.start_time)) / 60) from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = te.id and sh.shift_date = ${d.date}::date and coalesce(sh.status, 'scheduled') not in ('cancelled', 'canceled')),
            (select sum(extract(epoch from (sc.end_time - sc.start_time)) / 60 - coalesce(extract(epoch from (sc.lunch_end_time - sc.lunch_start_time)) / 60, 0)) from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = te.id and sc.day_of_week = extract(dow from ${d.date}::date) and sc.is_working), 0) as mins,
          exists (select 1 from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = te.id and tf.status = 'approved'
            and tf.starts_at <= (${d.date}::date)::timestamp at time zone ${d.tz} and tf.ends_at >= ((${d.date}::date + 1))::timestamp at time zone ${d.tz}) as off,
          ws.clock_status, ws.queue_status, coalesce(ws.manual_unavailable, false) as manual,
          exists (select 1 from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = te.id and a.appt_date = ${d.date}::date and a.status = 'in_service') as serving
        from technicians te left join technician_workforce_state ws on ws.technician_id = te.id and ws.tenant_id = te.tenant_id
        where te.tenant_id = ${T} and te.status = 'active' and coalesce(te.is_active, true) and te.archived_at is null and ${this.br(ctx)})
      select count(*) filter (where mins > 0 and not off)::int as working, coalesce(sum(mins) filter (where mins > 0 and not off), 0)::int as scheduled_minutes,
        count(*) filter (where clock_status in ('CLOCKED_IN', 'ON_BREAK'))::int as clocked_in,
        count(*) filter (where clock_status = 'CLOCKED_IN' and queue_status = 'AVAILABLE' and not manual and not serving)::int as available,
        count(*) filter (where serving or queue_status = 'SERVING')::int as in_service,
        count(*) filter (where clock_status = 'ON_BREAK' or queue_status = 'BREAK')::int as on_break
      from planned`.execute(this.db)).rows[0];
    const b = (await sql<any>`select coalesce(sum(coalesce(a.duration_minutes, 0)), 0)::int as booked, count(*)::int as n from pos_tech_appointments a join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id
      where a.tenant_id = ${T} and a.appt_date = ${d.date}::date and a.status not in ('cancelled', 'canceled', 'no_show') and ${this.brA(ctx)}`.execute(this.db)).rows[0];
    const live = d.when === 'today'; const sched = N(r?.scheduled_minutes); const booked = N(b?.booked);
    return { date: d.date, today: d.today, tz: d.tz, nowMinute: d.nowMinute, when: d.when, kpis: {
      workingToday: N(r?.working), clockedIn: live ? N(r?.clocked_in) : null, availableNow: live ? N(r?.available) : null, inService: live ? N(r?.in_service) : null, onBreak: live ? N(r?.on_break) : null,
      bookedMinutes: booked, bookedHours: Math.round((booked / 60) * 10) / 10, appointments: N(b?.n), scheduledMinutes: sched, utilizationPercent: sched > 0 ? Math.round((booked / sched) * 100) : null,
      utilizationBasis: d.when === 'past' ? 'booked' : 'forecast' } };
  }

  /** One search: technicians (name · id · phone · skill / service) AND appointments (customer · phone any format · service ·
   *  appointment id) — the server searches every record of the salon, not the board page; exact ids first. */
  async search(ctx: TeamCtx, q: { q?: string }) {
    const raw = String(q.q ?? '').trim().slice(0, 100);
    if (raw.length < 2) return { q: raw, technicians: { items: [], totalItems: 0 }, appointments: { items: [], totalItems: 0 } };
    const [t, a] = await Promise.all([
      this.techs.directory(ctx, { q: raw, status: 'current', sort: 'name', page: 1, pageSize: 6 }),
      this.appts.list(ctx, { q: raw, preset: 'all', sort: 'newest', page: 1, pageSize: 6 }),
    ]);
    return { q: raw,
      technicians: { totalItems: t.totalItems, items: t.items.map((x: any) => ({ technicianId: x.technicianId, name: x.name, avatarUrl: x.avatarUrl ?? null, role: x.role, working: x.working, shiftToday: x.shiftToday ?? null, matchedVia: x.matchedVia ?? null, matchedServices: x.matchedServices ?? [] })) },
      appointments: { totalItems: a.totalItems, items: a.items.map((x: any) => ({ appointmentId: x.appointmentId, customer: x.customer, phone: x.phone, technician: x.technician, technicianId: x.technicianId, date: x.date, start: x.start, end: x.end, services: x.services, status: x.status, matchedVia: x.matchedVia ?? null })) } };
  }

  /** Schedule activity: booking changes · status changes · breaks · time off · blocked time · weekly schedule edits —
   *  newest first (time desc, id desc). The live board keeps start-time order; only this history is newest-first. */
  async activity(ctx: TeamCtx, f: { q?: string; kind?: string; technicianId?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 8); const per = await teamPeriod(this.db, ctx, f, 'week');
    const kind = (ACTIVITY_KINDS as readonly string[]).includes(String(f.kind)) ? String(f.kind) : 'all';
    const tid = f.technicianId && UUID.test(f.technicianId) ? f.technicianId : null;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const ev = sql`select c.id, a.technician_id, 'booking' as kind, c.change_type as action, c.field, c.old_value, c.new_value, coalesce(a.customer_name, '') as subject, a.appt_date as on_date, a.start_time as at_time, c.actor_id, c.created_at as at
        from appointment_change_log c join pos_tech_appointments a on a.id = c.appointment_id and a.tenant_id = c.tenant_id where c.tenant_id = ${T}
      union all select s.id, s.technician_id, 'status', 'status', null, s.old_status, s.new_status, coalesce(s.reason, ''), null, null, s.changed_by_user_id, s.created_at from technician_status_events s where s.tenant_id = ${T}
      union all select k.id, k.technician_id, 'break', case when k.ended_at is null then 'break_started' else 'break_ended' end, coalesce(k.kind, 'break'), to_char(k.started_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'), case when k.ended_at is null then null else to_char(k.ended_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') end, coalesce(k.reason, ''), null, null, null, coalesce(k.ended_at, k.started_at) from technician_breaks k where k.tenant_id = ${T}
      union all select o.id, o.technician_id, 'time_off', 'time_off_' || coalesce(o.status, 'pending'), coalesce(o.kind, 'time_off'), to_char(o.starts_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'), to_char(o.ends_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'), coalesce(o.reason, ''), null, null, coalesce(o.approved_by, o.created_by_user_id), coalesce(o.decided_at, o.updated_at, o.created_at) from technician_time_off o where o.tenant_id = ${T}
      union all select bt.id, bt.technician_id, 'blocked', 'time_blocked', null, bt.start_time, bt.end_time, coalesce(bt.reason, ''), bt.block_date, bt.start_time, bt.created_by_user_id, bt.created_at from technician_blocked_times bt where bt.tenant_id = ${T}
      union all select sc.id, sc.technician_id, 'schedule', case when sc.is_working then 'weekly_hours' else 'weekly_off' end, sc.day_of_week::text, to_char(sc.start_time, 'HH24:MI'), to_char(sc.end_time, 'HH24:MI'), '', null, null, null::uuid, coalesce(sc.updated_at, sc.created_at) from technician_schedules sc where sc.tenant_id = ${T}`;
    const w = sql`te.tenant_id = ${T} and ${this.br(ctx)} and ${inPeriod(sql`x.at`, per)} and (${kind} = 'all' or x.kind = ${kind}) and (${tid}::uuid is null or x.technician_id = ${tid})
      and (${raw} = '' or coalesce(te.full_name, '') ilike ${l} or x.action ilike ${l} or coalesce(x.subject, '') ilike ${l} or coalesce(x.new_value, '') ilike ${l})`;
    const from = sql`from (${ev}) x join technicians te on te.id = x.technician_id and te.tenant_id = ${T} left join users u on u.id = x.actor_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where te.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.*, te.full_name, coalesce(nullif(u.full_name, ''), u.email) as actor ${from} where te.tenant_id = ${T} and ${w} order by x.at desc, x.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), technicianId: String(r.technician_id), technician: r.full_name ?? null, kind: String(r.kind), action: String(r.action ?? ''), field: r.field ?? null,
      oldValue: r.old_value ?? null, newValue: r.new_value ?? null, subject: r.subject || null, onDate: ymd(r.on_date), atTime: r.at_time ?? null, actor: r.actor ?? null, at: iso(r.at) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Before a weekly-shift change is saved: the booked appointments (today onward, 120 days) on that weekday that the new
   *  hours would leave outside the shift or inside the lunch — or every one of them when the day becomes a day off. Dates
   *  with their own published shift are governed by that shift and are not affected. Nothing is moved or cancelled. */
  async shiftImpact(ctx: TeamCtx, q: { technicianId?: string; dow?: unknown; working?: unknown; start?: string; end?: string; lunchStart?: string; lunchEnd?: string }) {
    const T = ctx.tenantId; const tid = q.technicianId && UUID.test(q.technicianId) ? q.technicianId : null;
    const dow = Math.trunc(Number(q.dow)); if (!tid || !(dow >= 0 && dow <= 6)) throw err(400, 'IMPACT_INPUT_INVALID', 'Choose a technician and a weekday.');
    const tech = (await sql<any>`select te.id from technicians te where te.tenant_id = ${T} and te.id = ${tid} and ${this.br(ctx)}`.execute(this.db)).rows[0];
    if (!tech) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const working = !(q.working === false || q.working === 'false' || q.working === '0');
    const s = HM.test(String(q.start)) ? minuteOf(q.start)! : null; const e = HM.test(String(q.end)) ? minuteOf(q.end)! : null;
    if (working && (s == null || e == null || e <= s)) throw err(400, 'SHIFT_RANGE_INVALID', 'The shift must end after it starts.');
    const ls = HM.test(String(q.lunchStart)) ? minuteOf(q.lunchStart) : null; const le = HM.test(String(q.lunchEnd)) ? minuteOf(q.lunchEnd) : null;
    const today = (await teamPeriod(this.db, ctx, { preset: 'today' })).today;
    const rows = (await sql<any>`select a.id, a.customer_name, a.appt_date, a.start_time, a.end_time, a.duration_minutes, a.status, a.services
      from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = ${tid} and a.status = any(${ACTIVE}) and a.appt_date >= ${today}::date and a.appt_date < ${today}::date + 120
        and extract(dow from a.appt_date) = ${dow}
        and not exists (select 1 from technician_shifts sh where sh.tenant_id = ${T} and sh.technician_id = a.technician_id and sh.shift_date = a.appt_date and coalesce(sh.status, 'scheduled') not in ('cancelled', 'canceled'))
      order by a.appt_date, a.start_time, a.id limit 200`.execute(this.db)).rows;
    const items = [] as { appointmentId: string; customer: string | null; date: string | null; start: string; end: string | null; status: string; reason: 'day_off' | 'outside_shift' | 'lunch' }[];
    for (const r of rows) {
      const as = minuteOf(r.start_time); if (as == null) continue;
      const ae = minuteOf(r.end_time) ?? as + N(r.duration_minutes);
      const reason = !working ? 'day_off' : as < s! || ae > e! ? 'outside_shift' : ls != null && le != null && le > ls && as < le && ae > ls ? 'lunch' : null;
      if (reason) items.push({ appointmentId: String(r.id), customer: r.customer_name ?? null, date: ymd(r.appt_date), start: String(r.start_time), end: r.end_time ?? null, status: String(r.status), reason });
    }
    return { technicianId: tid, dow, working, checkedFrom: today, days: 120, affected: items.length, items };
  }
}
