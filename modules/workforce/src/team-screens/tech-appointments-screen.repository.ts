// tech-appointments-screen.repository.ts — the read model behind the rebuilt Tech Appointments page (/tech-appointments,
// Oct 30 2026). It reads the ONE appointment ledger (pos_tech_appointments, shared with Booking and the Live Schedule) — no
// parallel copy — plus shifts, schedules, time off, blocked time and the change log. Every write stays on the existing
// TechAppointmentsController / Booking (create · reschedule · assign · check-in · cancel · no-show), which re-validate.
//
// The nine KPIs, for ONE selected salon day (appointments SCHEDULED that day, by appt_date — not created that day):
//   today = every appointment that day except deleted · booked = confirmed / booked / scheduled (not yet arrived)
//   checked in = arrived / checked_in · in service · completed · cancelled · no-shows = status no_show (never "late")
//   online = booked through an online channel (online / customer app / Google / AI / website), not "technician online"
//   conflicts = active appointments that overlap another active one of the SAME technician, or fall in her approved time
//   off — a multi-technician service is separate rows on separate technicians and never a conflict
import { sql, type Kysely } from 'kysely';
import { N, iso, like, err, maskPhone, phoneDigits, paging, served, branchOf, teamPeriod, inPeriod, dateInPeriod, minuteOf, UUID, type TeamCtx, canAny } from './screen-kit';
import { dateColumnYmd, addDays } from '@aipowersalon/date-time';

const ACTIVE = ['confirmed', 'booked', 'scheduled', 'pending', 'arrived', 'checked_in', 'waiting', 'assigned', 'in_service'];
const ONLINE = ['online', 'online_booking', 'customer_app', 'google', 'google_booking', 'ai', 'ai_booking', 'phone_ai', 'website', 'app'];
export const APPT_STATUSES = ['all', 'booked', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'conflict'] as const;
export const APPT_SORTS = ['start', 'newest', 'oldest'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (v: unknown) => dateColumnYmd(v);   // a Postgres DATE column (the driver's local-midnight Date) → its calendar day
const can = canAny;

export class TechAppointmentsScreenRepository {
  constructor(private readonly db: Kysely<any>) {}
  private br(ctx: TeamCtx) { const b = branchOf(ctx); return b ? sql`(a.branch_id = ${b} or a.branch_id is null)` : sql`true`; }
  private async day(ctx: TeamCtx, date?: string) { const p = await teamPeriod(this.db, ctx, { preset: 'today' }); return { ...p, date: date && YMD.test(date) ? date : p.today }; }
  /** start / end minutes of an appointment row (start_time / end_time are "HH:MM" text; end falls back to start + duration) */
  private conflictSql(T: string) {
    return sql`(a.status = any(${ACTIVE}) and (exists (select 1 from pos_tech_appointments o where o.tenant_id = ${T} and o.technician_id = a.technician_id and o.appt_date = a.appt_date and o.id <> a.id
        and o.status = any(${ACTIVE}) and o.start_time::time < coalesce(a.end_time::time, a.start_time::time + make_interval(mins => coalesce(a.duration_minutes, 0)))
        and coalesce(o.end_time::time, o.start_time::time + make_interval(mins => coalesce(o.duration_minutes, 0))) > a.start_time::time)
      or exists (select 1 from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = a.technician_id and tf.status = 'approved'
        and tf.starts_at < (a.appt_date + coalesce(a.end_time::time, a.start_time::time)) and tf.ends_at > (a.appt_date + a.start_time::time))))`;
  }

  async kpis(ctx: TeamCtx, q: { date?: string }) {
    const T = ctx.tenantId; const d = await this.day(ctx, q.date);
    const r = (await sql<any>`select count(*)::int as today,
        count(*) filter (where a.status in ('confirmed', 'booked', 'scheduled', 'pending'))::int as booked, count(*) filter (where a.status in ('arrived', 'checked_in', 'waiting'))::int as checked_in,
        count(*) filter (where a.status in ('in_service', 'assigned'))::int as in_service, count(*) filter (where a.status = 'completed')::int as completed,
        count(*) filter (where a.status in ('cancelled', 'canceled'))::int as cancelled, count(*) filter (where a.status = 'no_show')::int as no_show,
        count(*) filter (where lower(coalesce(a.source, '')) = any(${ONLINE}))::int as online, count(*) filter (where ${this.conflictSql(T)})::int as conflicts
      from pos_tech_appointments a where a.tenant_id = ${T} and a.appt_date = ${d.date}::date and ${this.br(ctx)}`.execute(this.db)).rows[0];
    return { date: d.date, today: d.today, tz: d.tz, nowMinute: d.nowMinute, kpis: { today: N(r?.today), booked: N(r?.booked), checkedIn: N(r?.checked_in), inService: N(r?.in_service), completed: N(r?.completed),
      cancelled: N(r?.cancelled), noShows: N(r?.no_show), online: N(r?.online), conflicts: N(r?.conflicts) } };
  }

  /** All Technician Appointments: one search (customer · phone any format · technician · service · appointment id), the
   *  scheduled or created date over a period, status / source / technician; start-time order or newest created first. */
  async list(ctx: TeamCtx, f: { q?: string; status?: string; source?: string; technicianId?: string; dateField?: string; sort?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await teamPeriod(this.db, ctx, f, 'today');
    const status = (APPT_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : 'all';
    const sort = (APPT_SORTS as readonly string[]).includes(String(f.sort)) ? String(f.sort) : 'start';
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const isId = UUID.test(raw);
    const tid = f.technicianId && UUID.test(f.technicianId) ? f.technicianId : null;
    const src = f.source === 'online' ? 'online' : f.source === 'in_salon' ? 'in_salon' : null;
    const dateW = f.dateField === 'created' ? inPeriod(sql`a.created_at`, per) : dateInPeriod(sql`a.appt_date`, per);
    const w = sql`a.tenant_id = ${T} and ${this.br(ctx)} and ${dateW} and (${tid}::uuid is null or a.technician_id = ${tid})
      and (${src}::text is null or (${src} = 'online') = (lower(coalesce(a.source, '')) = any(${ONLINE})))
      and (${status} = 'all' or (${status} = 'booked' and a.status in ('confirmed', 'booked', 'scheduled', 'pending')) or (${status} = 'checked_in' and a.status in ('arrived', 'checked_in', 'waiting'))
        or (${status} = 'in_service' and a.status in ('in_service', 'assigned')) or (${status} = 'cancelled' and a.status in ('cancelled', 'canceled')) or (${status} in ('completed', 'no_show') and a.status = ${status})
        or (${status} = 'conflict' and ${this.conflictSql(T)}))
      and (${raw} = '' or coalesce(a.customer_name, '') ilike ${l} or coalesce(te.full_name, '') ilike ${l} or a.services::text ilike ${l} or (${isId} and a.id::text = ${raw.toLowerCase()})
        or (${phoneish} and regexp_replace(coalesce(a.customer_phone, cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'}))`;
    const from = sql`from pos_tech_appointments a left join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id left join customers cu on cu.id = a.customer_id and cu.tenant_id = a.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where a.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const order = sort === 'newest' ? sql`a.created_at desc, a.id desc` : sort === 'oldest' ? sql`a.created_at asc, a.id asc` : sql`a.appt_date asc, a.start_time::time asc, a.id asc`;
    const rows = (await sql<any>`select a.id, a.appt_date, a.start_time, a.end_time, a.duration_minutes, a.status, a.source, a.services, a.customer_name, a.customer_phone, a.is_vip, a.version, a.created_at, a.technician_id, a.any_technician,
        te.full_name as tech_name, ${this.conflictSql(T)} as conflict,
        case when ${isId} and a.id::text = ${raw.toLowerCase()} then 'id' when ${phoneish} and regexp_replace(coalesce(a.customer_phone, cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'} then 'phone'
          when coalesce(a.customer_name, '') ilike ${l} then 'customer' when coalesce(te.full_name, '') ilike ${l} then 'technician' when a.services::text ilike ${l} then 'service' else null end as matched_via
      ${from} where a.tenant_id = ${T} and ${w} order by ${order} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const customers = can(ctx, 'customers.view');
    return { period: per, status, sort, items: rows.map((r: any) => this.row(r, customers, raw ? r.matched_via : null)), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  private row(r: any, customers: boolean, via: string | null) {
    const services = Array.isArray(r.services) ? r.services.map((s: any) => String(s?.name ?? s?.serviceName ?? s?.label ?? '')).filter(Boolean) : [];
    return { appointmentId: String(r.id), date: ymd(r.appt_date), start: r.start_time ?? null, end: r.end_time ?? null, minutes: N(r.duration_minutes), status: String(r.status ?? ''), source: r.source ?? null,
      online: ONLINE.includes(String(r.source ?? '').toLowerCase()), services, customer: customers ? r.customer_name ?? null : null, phone: customers ? maskPhone(r.customer_phone) : null, vip: !!r.is_vip,
      technicianId: r.technician_id ? String(r.technician_id) : null, technician: r.tech_name ?? null, anyTechnician: !!r.any_technician, conflict: !!r.conflict, version: r.version == null ? null : N(r.version),
      matchedVia: via, createdAt: iso(r.created_at) };
  }

  /** the Week board: per technician per day — appointments and booked minutes (cancelled / no-show excluded) */
  async week(ctx: TeamCtx, q: { start?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const d = await this.day(ctx, q.start); const { page, pageSize } = paging(q.page, q.pageSize, 12);
    const monday = (await sql<any>`select to_char(date_trunc('week', ${d.date}::date)::date, 'YYYY-MM-DD') as m`.execute(this.db)).rows[0].m as string;
    const b = branchOf(ctx);
    const total = N((await sql<any>`select count(*)::int as n from technicians te where te.tenant_id = ${T} and te.archived_at is null and te.status = 'active' and (${b}::uuid is null or te.branch_id = ${b} or te.branch_id is null)`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const techs = (await sql<any>`select te.id, coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as name from technicians te
      where te.tenant_id = ${T} and te.archived_at is null and te.status = 'active' and (${b}::uuid is null or te.branch_id = ${b} or te.branch_id is null) order by lower(te.full_name), te.id limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const cells = techs.length ? (await sql<any>`select a.technician_id, to_char(a.appt_date, 'YYYY-MM-DD') as day, count(*)::int as n, coalesce(sum(a.duration_minutes), 0)::int as mins
      from pos_tech_appointments a where a.tenant_id = ${T} and a.appt_date >= ${monday}::date and a.appt_date < ${monday}::date + 7 and a.status not in ('cancelled', 'canceled', 'no_show')
        and a.technician_id in (${sql.join(techs.map((t: any) => sql`${t.id}`))}) group by 1, 2`.execute(this.db)).rows : [];
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    return { weekStart: monday, days, today: d.today, technicians: techs.map((t: any) => ({ technicianId: String(t.id), name: String(t.name || ''),
      days: days.map((day) => { const c = cells.find((x: any) => String(x.technician_id) === String(t.id) && x.day === day); return { date: day, appointments: N(c?.n), bookedMinutes: N(c?.mins) }; }) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Schedule conflict warning: every reason a technician cannot take [start, start + minutes) on a day — overlap, outside
   *  the shift, the lunch / break in her weekly hours, time off, blocked time, not qualified for a service. Read only. */
  async conflicts(ctx: TeamCtx, q: { technicianId?: string; date?: string; start?: string; minutes?: unknown; serviceIds?: string; appointmentId?: string }) {
    const T = ctx.tenantId; const d = await this.day(ctx, q.date);
    const tid = q.technicianId && UUID.test(q.technicianId) ? q.technicianId : null; if (!tid) throw err(400, 'TECHNICIAN_REQUIRED', 'Choose a technician.');
    const s = minuteOf(q.start); const mins = Math.max(1, Math.min(720, Math.trunc(Number(q.minutes)) || 0));
    if (s == null || !Number(q.minutes)) throw err(400, 'DATE_START_REQUIRED', 'Choose a start time and a duration.');
    const e = s + mins; const skip = q.appointmentId && UUID.test(q.appointmentId) ? q.appointmentId : null;
    const tech = (await sql<any>`select te.id, te.full_name, te.status, te.branch_id, te.service_eligibility_mode from technicians te where te.tenant_id = ${T} and te.id = ${tid}`.execute(this.db)).rows[0];
    if (!tech) throw err(404, 'TECHNICIAN_NOT_FOUND', 'Technician not found');
    const reasons: Array<{ kind: string; from?: string | null; to?: string | null; detail?: string | null; appointmentId?: string }> = [];
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (tech.status !== 'active') reasons.push({ kind: 'not_active', detail: String(tech.status) });
    const b = branchOf(ctx); if (b && tech.branch_id && String(tech.branch_id) !== b) reasons.push({ kind: 'other_branch' });
    const appts = (await sql<any>`select a.id, a.start_time, a.end_time, a.duration_minutes, a.customer_name from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = ${tid} and a.appt_date = ${d.date}::date
      and a.status = any(${ACTIVE}) and (${skip}::uuid is null or a.id <> ${skip})`.execute(this.db)).rows;
    for (const a of appts) { const as = minuteOf(a.start_time); const ae = minuteOf(a.end_time) ?? (as == null ? null : as + N(a.duration_minutes)); if (as != null && ae != null && as < e && ae > s) reasons.push({ kind: 'overlap', from: hm(as), to: hm(ae), appointmentId: String(a.id), detail: can(ctx, 'customers.view') ? a.customer_name ?? null : null }); }
    const shift = (await sql<any>`select to_char(sh.start_time at time zone ${d.tz}, 'HH24:MI') as s, to_char(sh.end_time at time zone ${d.tz}, 'HH24:MI') as e from technician_shifts sh
      where sh.tenant_id = ${T} and sh.technician_id = ${tid} and sh.shift_date = ${d.date}::date and coalesce(sh.status, 'scheduled') not in ('cancelled', 'canceled') order by sh.start_time limit 1`.execute(this.db)).rows[0];
    const weekly = (await sql<any>`select to_char(sc.start_time, 'HH24:MI') as s, to_char(sc.end_time, 'HH24:MI') as e, to_char(sc.lunch_start_time, 'HH24:MI') as ls, to_char(sc.lunch_end_time, 'HH24:MI') as le, sc.is_working
      from technician_schedules sc where sc.tenant_id = ${T} and sc.technician_id = ${tid} and sc.day_of_week = extract(dow from ${d.date}::date)::int limit 1`.execute(this.db)).rows[0];
    const win = shift ?? (weekly?.is_working ? weekly : null);
    if (!win) reasons.push({ kind: 'no_shift' });
    else { const ws = minuteOf(win.s), we = minuteOf(win.e); if (ws != null && we != null && (s < ws || e > we)) reasons.push({ kind: 'outside_shift', from: win.s, to: win.e }); }
    if (weekly?.ls && weekly?.le) { const ls = minuteOf(weekly.ls), le = minuteOf(weekly.le); if (ls != null && le != null && ls < e && le > s) reasons.push({ kind: 'break', from: weekly.ls, to: weekly.le }); }
    const off = (await sql<any>`select tf.kind, tf.reason from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = ${tid} and tf.status = 'approved'
      and tf.starts_at < ((${d.date}::date)::timestamp + make_interval(mins => ${e})) at time zone ${d.tz} and tf.ends_at > ((${d.date}::date)::timestamp + make_interval(mins => ${s})) at time zone ${d.tz} limit 1`.execute(this.db)).rows[0];
    if (off) reasons.push({ kind: 'time_off', detail: off.kind ?? null });
    const blocks = (await sql<any>`select bt.start_time, bt.end_time, bt.reason from technician_blocked_times bt where bt.tenant_id = ${T} and bt.technician_id = ${tid} and bt.block_date = ${d.date}::date`.execute(this.db)).rows;
    for (const x of blocks) { const bs = minuteOf(x.start_time), be = minuteOf(x.end_time); if (bs != null && be != null && bs < e && be > s) reasons.push({ kind: 'blocked', from: x.start_time, to: x.end_time, detail: x.reason ?? null }); }
    const sids = String(q.serviceIds ?? '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x)).slice(0, 20);
    if (sids.length && tech.service_eligibility_mode !== 'legacy') {
      const ok = (await sql<any>`select m.service_id from technician_services m where m.tenant_id = ${T} and m.technician_id = ${tid} and m.service_id in (${sql.join(sids.map((x) => sql`${x}`))})`.execute(this.db)).rows.map((r: any) => String(r.service_id));
      const missing = sids.filter((x) => !ok.includes(x));
      if (missing.length) { const names = (await sql<any>`select s.name from services s where s.tenant_id = ${T} and s.id in (${sql.join(missing.map((x) => sql`${x}`))}) order by s.name`.execute(this.db)).rows.map((r: any) => String(r.name));
        reasons.push({ kind: 'not_qualified', detail: names.join(', ') }); }
    }
    return { technicianId: tid, technician: tech.full_name ?? null, date: d.date, start: hm(s), end: hm(e), minutes: mins, ok: reasons.length === 0, reasons };
  }

  /** Recent booking changes: the appointment change log, newest first, with its actor and source */
  async history(ctx: TeamCtx, f: { q?: string; changeType?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await teamPeriod(this.db, ctx, f, 'week');
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    const kind = ['created', 'updated', 'cancelled', 'rescheduled', 'all'].includes(String(f.changeType)) ? String(f.changeType) : 'all';
    const w = sql`h.tenant_id = ${T} and ${inPeriod(sql`h.created_at`, per)} and (${kind} = 'all' or h.change_type ilike ${'%' + kind.replace(/ed$/, '') + '%'})
      and (${raw} = '' or h.change_type ilike ${l} or coalesce(h.field, '') ilike ${l} or coalesce(a.customer_name, '') ilike ${l} or coalesce(te.full_name, '') ilike ${l} or coalesce(u.full_name, '') ilike ${l})`;
    const from = sql`from appointment_change_log h left join pos_tech_appointments a on a.id = h.appointment_id and a.tenant_id = h.tenant_id left join technicians te on te.id = a.technician_id and te.tenant_id = a.tenant_id
      left join users u on u.id = h.actor_id and u.tenant_id = h.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where h.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select h.id, h.appointment_id, h.change_type, h.field, h.old_value, h.new_value, h.actor_type, h.source, h.created_at, a.customer_name, a.appt_date, a.start_time, te.full_name as tech, coalesce(nullif(u.full_name, ''), u.email) as actor
      ${from} where h.tenant_id = ${T} and ${w} order by h.created_at desc, h.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const customers = can(ctx, 'customers.view');
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), appointmentId: r.appointment_id ? String(r.appointment_id) : null, changeType: String(r.change_type ?? ''), field: r.field ?? null,
      oldValue: r.old_value ?? null, newValue: r.new_value ?? null, actor: r.actor ?? (r.actor_type ? String(r.actor_type) : null), source: r.source ?? null, at: iso(r.created_at),
      customer: customers ? r.customer_name ?? null : null, technician: r.tech ?? null, apptDate: ymd(r.appt_date), apptStart: r.start_time ?? null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
}
