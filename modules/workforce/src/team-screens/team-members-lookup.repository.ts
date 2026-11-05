// team-members-lookup.repository.ts — Team Management round 2A (Four-Module Completion Guide §8.1 / §9.1, 30 Oct 2026).
//   customerLinks   TM-01 "which staff served / are booked for THIS customer": a customer's name or phone (any format) →
//                   this salon's customers → their appointments (pos_tech_appointments.technician_id, not cancelled / no-show)
//                   and completed services (ticket_service_lines.technician_id + tickets.primary_technician_id /
//                   helper_technician_id on completed, not removed, not voided tickets) → the staff members. Every technician
//                   on a multi-technician ticket is returned; each result says WHY (appointment / service line / primary /
//                   helper) with the record references (appointment id · ticket number · date). Needs customers.view; the
//                   customer's phone is NEVER returned in full (masked to the last 4), notes are never read.
//   preferredCheck  TM-04 the optional preferred technician of Find Qualified & Available Staff: service mapping, branch,
//                   shift (one-date override › weekly template, the booking engine's own effectiveDaySchedule), breaks / lunch,
//                   blocked time, approved time off, chair-holding appointments and the full duration at the asked start
//                   (or her earliest valid start) — and the qualified alternatives that pass the same checks. Never books.
// Tenant is literal in every statement; branch is the session's. Read only.
import { sql, type Kysely } from 'kysely';
import { effectiveDaySchedule, addLocalDays, pbTimeOffToBlock, type ShiftOverride, type PBTechDaySchedule } from '@aipowersalon/booking';
import { CHAIR_HOLDING_STATUSES } from '@aipowersalon/api-contracts';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { N, iso, like, err, maskPhone, phoneDigits, paging, served, branchOf, teamPeriod, minuteOf, UUID, canAny, type TeamCtx, type TPeriod } from './screen-kit';
import { TeamMembersScreenRepository } from './team-members-screen.repository';
import { evaluateWindow, rankPreferred, type DayFacts } from './preferred-staff';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CUSTOMER_VIEW = ['customers.view'];
const HOLDING: string[] = [...CHAIR_HOLDING_STATUSES];
export const LINK_KINDS = ['appointment', 'service_line', 'ticket_primary', 'ticket_helper'] as const;
const hm = (v: unknown) => (v == null ? null : String(v).slice(0, 5));

export class TeamMembersLookupRepository {
  private readonly members: TeamMembersScreenRepository;
  constructor(private readonly db: Kysely<any>) { this.members = new TeamMembersScreenRepository(db); }

  // ── TM-01 customer-linked staff search ─────────────────────────────────────────────────────────────────────────
  /** the customers + links CTEs (appended to the roster's WITH) for one search; phone ≥ 7 digits, or a name ≥ 2 letters */
  private linkCtes(ctx: TeamCtx, raw: string) {
    const T = ctx.tenantId; const b = branchOf(ctx); const { d, phoneish } = phoneDigits(raw);
    const byPhone = phoneish && d.length >= 7; const l = like(raw);
    const brA = b ? sql`(a.branch_id = ${b} or a.branch_id is null)` : sql`true`; const brT = b ? sql`(t.branch_id = ${b} or t.branch_id is null)` : sql`true`;
    const done = sql`t.removed_at is null and coalesce(t.payment_status, '') <> 'voided' and (t.paid_at is not null or t.service_done_at is not null)`;
    const match = byPhone
      ? sql`right(regexp_replace(coalesce(c.normalized_phone, c.phone_display, ''), '[^0-9]', '', 'g'), 10) like ${'%' + d + '%'}`
      : sql`(c.full_name ilike ${l} or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike ${l})`;
    return sql`, cu as (select c.id, c.full_name, coalesce(c.phone_display, c.normalized_phone) as phone from customers c
          where c.tenant_id = ${T} and c.archived_at is null and ${match} order by lower(c.full_name), c.id limit 25),
        lk as (
          select a.customer_id, a.technician_id, 'appointment'::text as kind, a.id as ref_id, null::text as ref_no, to_char(a.appt_date, 'YYYY-MM-DD') as ref_date, a.start_time as ref_time, a.status as ref_status, null::text as ref_service
            from pos_tech_appointments a join cu on cu.id = a.customer_id where a.tenant_id = ${T} and a.technician_id is not null and coalesce(a.status, '') not in ('cancelled', 'canceled', 'no_show') and ${brA}
          union all
          select t.customer_id, l.technician_id, 'service_line', t.id, t.ticket_number, to_char(coalesce(t.paid_at, t.service_done_at), 'YYYY-MM-DD'), null, 'completed', l.service_name_snapshot
            from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id join cu on cu.id = t.customer_id
            where l.tenant_id = ${T} and l.technician_id is not null and l.removed_at is null and ${done} and ${brT}
          union all
          select t.customer_id, t.primary_technician_id, 'ticket_primary', t.id, t.ticket_number, to_char(coalesce(t.paid_at, t.service_done_at), 'YYYY-MM-DD'), null, 'completed', null
            from tickets t join cu on cu.id = t.customer_id where t.tenant_id = ${T} and t.primary_technician_id is not null and ${done} and ${brT}
          union all
          select t.customer_id, t.helper_technician_id, 'ticket_helper', t.id, t.ticket_number, to_char(coalesce(t.paid_at, t.service_done_at), 'YYYY-MM-DD'), null, 'completed', null
            from tickets t join cu on cu.id = t.customer_id where t.tenant_id = ${T} and t.helper_technician_id is not null and ${done} and ${brT})`;
  }

  /** TM-01 (Nov 5 2026 gap): `archived` = 'include' also lists staff who have since been archived (marked archived) — the
   *  customer's history keeps who served them; default: current staff only, as before */
  async customerLinks(ctx: TeamCtx, f: { q?: string; archived?: string; page?: unknown; pageSize?: unknown }) {
    if (!canAny(ctx, ...CUSTOMER_VIEW)) throw err(403, 'CUSTOMER_SEARCH_FORBIDDEN', 'You do not have permission to search by customer.');
    const raw = String(f.q ?? '').trim().slice(0, 100); const { d, phoneish } = phoneDigits(raw);
    const byPhone = phoneish && d.length >= 7;
    if (!byPhone && (phoneish || raw.replace(/[^\p{L}]/gu, '').length < 2)) throw err(422, 'CUSTOMER_QUERY_TOO_SHORT', 'Type at least 2 letters of the customer\'s name or 7 digits of the phone number.');
    const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const today = await this.members.period(ctx, { preset: 'today' }); const R = this.members.roster(ctx, today); const L = this.linkCtes(ctx, raw);
    const g = sql`g as (select m.member_id, max(lk.ref_date) as last_date, count(distinct lk.kind || ':' || lk.ref_id)::int as refs, count(distinct lk.customer_id)::int as customers,
        array_agg(distinct lk.kind) as kinds from lk join m on m.technician_id = lk.technician_id where (m.is_current or ${f.archived === 'include'}) group by m.member_id)`;
    const head = (await sql<any>`${R}${L}, ${g} select (select count(*)::int from cu) as customers, (select count(*)::int from g) as members`.execute(this.db)).rows[0];
    const total = N(head?.members); const sp = served(page, pageSize, total);
    const rows = (await sql<any>`${R}${L}, ${g} select m.member_id, m.technician_id, m.user_id, m.name, m.avatar_url, m.roles, m.code, m.live, m.is_current, g.last_date, g.refs, g.customers, g.kinds
      from g join m on m.member_id = g.member_id order by g.last_date desc nulls last, m.member_id limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const tids = rows.map((r: any) => String(r.technician_id));
    const refs = tids.length ? (await sql<any>`${R}${L} select lk.*, cu.full_name as customer_name, cu.phone as customer_phone from lk join cu on cu.id = lk.customer_id
        where lk.technician_id = any(${tids}::uuid[]) order by lk.ref_date desc nulls last, lk.ref_time desc nulls last, lk.kind, lk.ref_id`.execute(this.db)).rows : [];
    const by = new Map<string, any[]>(); for (const x of refs) { const k = String(x.technician_id); const a = by.get(k) ?? []; a.push(x); by.set(k, a); }
    const customers = (await sql<any>`${R}${L} select cu.id, cu.full_name, cu.phone from cu order by lower(cu.full_name), cu.id limit 10`.execute(this.db)).rows;
    return {
      query: { kind: byPhone ? 'phone' : 'name' }, matchedCustomers: N(head?.customers),
      customers: customers.map((c: any) => ({ customerId: String(c.id), name: String(c.full_name ?? ''), phone: maskPhone(c.phone) })),
      items: rows.map((r: any) => {
        const mine = by.get(String(r.technician_id)) ?? [];
        // one reason line per record (a ticket where she is primary AND has lines shows once, with every role she had)
        const seen = new Map<string, any>();
        for (const x of mine) { const k = (x.kind === 'appointment' ? 'a:' : 't:') + x.ref_id; const cur = seen.get(k);
          if (cur) { if (!cur.kinds.includes(x.kind)) cur.kinds.push(x.kind); if (x.ref_service && !cur.services.includes(x.ref_service)) cur.services.push(x.ref_service); continue; }
          seen.set(k, { kind: x.kind === 'appointment' ? 'appointment' : 'ticket', kinds: [x.kind], refId: String(x.ref_id), ticketNumber: x.ref_no ?? null, date: x.ref_date ?? null, time: hm(x.ref_time), status: x.ref_status ?? null,
            services: x.ref_service ? [String(x.ref_service)] : [], customerId: String(x.customer_id), customerName: String(x.customer_name ?? ''), customerPhone: maskPhone(x.customer_phone),
            upcoming: x.kind === 'appointment' && String(x.ref_date ?? '') >= today.today }); }
        const reasons = [...seen.values()];
        return { memberId: String(r.member_id), technicianId: String(r.technician_id), userId: r.user_id ? String(r.user_id) : null, name: String(r.name ?? ''), avatarUrl: r.avatar_url ?? null,
          roles: (r.roles ?? []) as string[], code: String(r.code), live: String(r.live), archived: !r.is_current, lastDate: r.last_date ?? null, linkCount: reasons.length, customersMatched: N(r.customers),
          kinds: (r.kinds ?? []) as string[], reasons: reasons.slice(0, 5), moreReasons: Math.max(0, reasons.length - 5) };
      }),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages,
      rule: 'appointments (not cancelled / no-show) and completed services on this salon\'s tickets; every technician on a shared ticket; customer phone masked',
    };
  }

  // ── TM-04 preferred technician ───────────────────────────────────────────────────────────────────────────────
  async preferredCheck(ctx: TeamCtx, q: { technicianId?: unknown; date?: unknown; time?: unknown; serviceIds?: unknown }) {
    const T = ctx.tenantId; const b = branchOf(ctx);
    const pid = String(q.technicianId ?? ''); if (!UUID.test(pid)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const per: TPeriod = await teamPeriod(this.db, ctx, { preset: 'today' });
    const date = YMD.test(String(q.date ?? '')) ? String(q.date) : per.today;
    if (date < per.today) throw err(422, 'DATE_IN_PAST', 'Choose today or a later date.');
    const time = q.time == null || q.time === '' ? null : String(q.time);
    if (time != null && !HM.test(time)) throw err(422, 'TIME_INVALID', 'Choose a start time (HH:MM).');
    const ids = [...new Set((Array.isArray(q.serviceIds) ? q.serviceIds : String(q.serviceIds ?? '').split(',')).map((x) => String(x).trim()).filter((x) => UUID.test(x)))].slice(0, 10);
    if (!ids.length) throw err(422, 'SERVICE_REQUIRED', 'Choose at least one service.');
    const svc = (await sql<any>`select s.id, s.name, s.duration_minutes from services s where s.tenant_id = ${T} and s.id = any(${ids}::uuid[]) and s.archived_at is null
      and coalesce(s.status, 'active') = 'active' order by lower(s.name), s.id`.execute(this.db)).rows;
    if (svc.length !== ids.length) throw err(422, 'SERVICE_NOT_FOUND', 'One of the chosen services is not offered by this salon.');
    const duration = svc.reduce((a: number, s: any) => a + Math.max(0, N(s.duration_minutes)), 0) || 30;
    const pref = (await sql<any>`select te.id from technicians te where te.tenant_id = ${T} and te.id = ${pid} and te.archived_at is null`.execute(this.db)).rows[0];
    if (!pref) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    // candidates: the preferred technician (wherever she works) + every current technician of the branch mapped to EVERY service
    const cands = (await sql<any>`select te.id, coalesce(nullif(te.full_name, ''), nullif(trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, '')), ''), 'Technician') as name,
        te.branch_id, coalesce(te.status, 'active') as status, coalesce(te.is_active, true) as is_active,
        array(select m3.service_id::text from technician_services m3 where m3.tenant_id = ${T} and m3.technician_id = te.id and m3.service_id = any(${ids}::uuid[])) as mapped
      from technicians te where te.tenant_id = ${T} and te.archived_at is null and (te.id = ${pid} or ((${b}::uuid is null or te.branch_id = ${b} or te.branch_id is null) and coalesce(te.status, 'active') = 'active'
        and (select count(distinct m4.service_id) from technician_services m4 where m4.tenant_id = ${T} and m4.technician_id = te.id and m4.service_id = any(${ids}::uuid[])) = ${ids.length}))
      order by (te.id = ${pid}) desc, lower(coalesce(te.full_name, '')), te.id limit 300`.execute(this.db)).rows;
    const cids = cands.map((c: any) => String(c.id)); const prev = addLocalDays(date, -1);
    const dayStart = localDateTimeToEpochMs(date, '00:00', per.tz), dayEnd = localDateTimeToEpochMs(addLocalDays(date, 1), '00:00', per.tz);
    const [weekly, overrides, blocks, offs, appts] = await Promise.all([
      sql<any>`select distinct on (sc.technician_id) sc.technician_id, sc.is_working, to_char(sc.start_time, 'HH24:MI') as s, to_char(sc.end_time, 'HH24:MI') as e, to_char(sc.lunch_start_time, 'HH24:MI') as ls,
          to_char(sc.lunch_end_time, 'HH24:MI') as le, sc.shifts, sc.breaks from technician_schedules sc
        where sc.tenant_id = ${T} and sc.technician_id = any(${cids}::uuid[]) and sc.day_of_week = extract(dow from ${date}::date) and (${b}::uuid is null or sc.branch_id = ${b} or sc.branch_id is null)
        order by sc.technician_id, (sc.branch_id is null), sc.updated_at desc nulls last`.execute(this.db),
      sql<any>`select o.technician_id, to_char(o.local_shift_date, 'YYYY-MM-DD') as d, o.override_type, to_char(o.start_local_time, 'HH24:MI') as s, to_char(o.end_local_time, 'HH24:MI') as e, o.ends_next_day, o.breaks_json, o.version
        from technician_shift_overrides o where o.tenant_id = ${T} and o.technician_id = any(${cids}::uuid[]) and o.local_shift_date = any(${[date, prev]}::date[]) and (${b}::uuid is null or o.branch_id = ${b})`.execute(this.db),
      sql<any>`select bt.technician_id, bt.start_time, bt.end_time, bt.reason from technician_blocked_times bt where bt.tenant_id = ${T} and bt.technician_id = any(${cids}::uuid[]) and bt.block_date = ${date}::date
        and (${b}::uuid is null or bt.branch_id = ${b})`.execute(this.db),
      sql<any>`select tf.technician_id, tf.starts_at, tf.ends_at, tf.kind, tf.reason from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = any(${cids}::uuid[]) and tf.status = 'approved'
        and tf.starts_at < ${new Date(dayEnd)} and tf.ends_at > ${new Date(dayStart)}`.execute(this.db),
      sql<any>`select a.id, a.technician_id, a.start_time, a.end_time, a.status from pos_tech_appointments a where a.tenant_id = ${T} and a.technician_id = any(${cids}::uuid[]) and a.appt_date = ${date}::date
        and a.status = any(${HOLDING}::text[]) and (${b}::uuid is null or a.branch_id = ${b} or a.branch_id is null) order by a.start_time, a.id`.execute(this.db),
    ]);
    const group = <X>(rows: X[], key: (x: X) => string) => { const m = new Map<string, X[]>(); for (const x of rows) { const k = key(x); const a = m.get(k) ?? []; a.push(x); m.set(k, a); } return m; };
    const wk = new Map<string, any>(weekly.rows.map((r: any) => [String(r.technician_id), r]));
    const ov = new Map<string, any>(overrides.rows.map((r: any) => [`${r.technician_id}|${r.d}`, r]));
    const bl = group(blocks.rows, (r: any) => String(r.technician_id)); const tf = group(offs.rows, (r: any) => String(r.technician_id)); const ap = group(appts.rows, (r: any) => String(r.technician_id));
    const toOverride = (r: any): ShiftOverride | null => (r ? { technicianId: String(r.technician_id), localDate: String(r.d), overrideType: r.override_type, startLocalTime: hm(r.s), endLocalTime: hm(r.e), endsNextDay: !!r.ends_next_day,
      breaks: Array.isArray(r.breaks_json) ? r.breaks_json : [], version: N(r.version) } : null);
    const nameOf = new Map<string, string>(svc.map((s: any) => [String(s.id), String(s.name)]));
    const facts = (c: any): DayFacts => {
      const id = String(c.id); const w = wk.get(id);
      const base: PBTechDaySchedule | null = w ? { isWorking: !!w.is_working, startTime: w.s, endTime: w.e, lunchStartTime: w.ls, lunchEndTime: w.le,
        shifts: Array.isArray(w.shifts) && w.shifts.length ? w.shifts : null, breaks: Array.isArray(w.breaks) && w.breaks.length ? w.breaks : null } : null;
      const o = toOverride(ov.get(`${id}|${date}`)); const po = toOverride(ov.get(`${id}|${prev}`));
      const schedule = effectiveDaySchedule(base, o, po);
      const offBlocks = (tf.get(id) ?? []).map((t: any) => pbTimeOffToBlock({ startsAtMs: new Date(t.starts_at).getTime(), endsAtMs: new Date(t.ends_at).getTime(), reason: t.kind ? String(t.kind).toLowerCase() : t.reason }, dayStart, dayEnd, per.tz)).filter(Boolean) as { startTime: string; endTime: string; reason: string }[];
      const mapped = new Set<string>((c.mapped ?? []).map(String));
      return { technicianId: id, name: String(c.name), active: c.status === 'active' && c.is_active !== false, inBranch: !b || c.branch_id == null || String(c.branch_id) === b,
        missingServices: ids.filter((x) => !mapped.has(x)).map((x) => nameOf.get(x) ?? x),
        schedule, scheduleSource: o ? (o.overrideType === 'DAY_OFF' ? 'override_off' : 'override') : w ? 'weekly' : 'none',
        blocks: [...(bl.get(id) ?? []).map((x: any) => ({ startTime: String(x.start_time).slice(0, 5), endTime: String(x.end_time).slice(0, 5), reason: String(x.reason || 'blocked') })), ...offBlocks],
        appointments: (ap.get(id) ?? []).map((a: any) => ({ id: String(a.id), startTime: String(a.start_time).slice(0, 5), endTime: String(a.end_time).slice(0, 5), status: String(a.status) })) };
    };
    const notBefore = date === per.today ? per.nowMinute : -1; const at = time ? minuteOf(time) : null;
    const pc = cands.find((c: any) => String(c.id) === pid); const prefV = evaluateWindow(facts(pc), at, duration, notBefore);
    // alternatives: at the SAME start when one was asked (else the earliest valid start); fall back to their earliest start
    const others = cands.filter((c: any) => String(c.id) !== pid).map((c: any) => { const f0 = facts(c); const v = evaluateWindow(f0, at, duration, notBefore); return v.valid || at == null ? v : evaluateWindow(f0, null, duration, notBefore); });
    const ranked = rankPreferred(prefV, others, 5);
    const live = date === per.today ? (await sql<any>`select ws.queue_status, ws.clock_status from technician_workforce_state ws where ws.tenant_id = ${T} and ws.technician_id = ${pid}`.execute(this.db)).rows[0] ?? null : null;
    return { date, time, today: per.today, tz: per.tz, durationMinutes: duration, services: svc.map((s: any) => ({ serviceId: String(s.id), name: String(s.name), durationMinutes: N(s.duration_minutes) })),
      preferred: { ...ranked.preferred!, liveNow: live ? { queue: live.queue_status ?? null, clock: live.clock_status ?? null } : null },
      preferredFirst: ranked.preferredFirst, alternatives: ranked.alternatives, evaluated: cands.length, asOf: iso(new Date()),
      rule: 'checked against the one-date override or weekly template, breaks, blocked time, approved time off, chair-holding appointments and the full duration; Booking re-checks before it saves — nothing is booked here' };
  }
}
