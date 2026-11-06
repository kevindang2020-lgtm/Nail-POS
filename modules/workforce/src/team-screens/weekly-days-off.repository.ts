// weekly-days-off.repository.ts — Technician Profile & Team Management guide (Nov 5 2026, G3 §7, migration 816):
// a manager sets a technician off EVERY week on one or more weekdays (e.g. Monday + Tuesday) from an effective date,
// until changed or an end date. The rule is a branch-local calendar rule read by the one schedule precedence
// (date override > weekly day-off rule > weekly template — @aipowersalon/booking weekly-off.ts), so Booking, Find
// Opening, the Live Technician Schedule, the Team lookup and the Technician App all agree.
//
//   list     the technician's rules (newest first), the live one, the append-only history and a month preview
//   preview  the before / after week and every confirmed future booking on the new off days (nothing written)
//   save     versioned: the current rule ENDS the day before the new one starts (past dates keep their rule); a booking on a
//            new off day blocks the save (409 SCHEDULE_CONFLICT) until the manager acknowledges it — bookings are never
//            cancelled, moved or reassigned here; one transaction: rule rows, history, audit row, outbox event
//   end      Remove Recurrence from a date (the last off day is the day before)
// Planned days off are not paid leave and never touch Time Clock or payroll hours.
// Events carry clock_timestamp(): a change writes SUPERSEDED then CREATED in ONE transaction, and now() would give both the
// same instant (the history list then ordered them by random uuid).
import { sql, type Kysely } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { addLocalDays, weekdayOf } from '@aipowersalon/booking';
import { N, iso, branchOf, teamPeriod, UUID, err, canAny, type TeamCtx } from './screen-kit';
import { writeAuditRow } from './audit-rows';
import { canMoveToSql } from '@aipowersalon/database';
import { TECHNICIAN_WEEKLY_OFF_RULE } from '../workforce-lifecycles';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const VIEW = ['pos.technicians.view', 'pos.technicians.schedule.edit'];
const EDIT = ['pos.technicians.schedule.edit'];
const HOLDING = ['scheduled', 'confirmed', 'booked', 'checked_in', 'arrived', 'pending'];
const HORIZON_DAYS = 180;   // conflicts are listed for the next six months of an open-ended rule
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface WeeklyOffBody { technicianId?: unknown; weekdays?: unknown; effectiveFrom?: unknown; effectiveTo?: unknown; reason?: unknown; expectedVersion?: unknown; acknowledgeConflicts?: unknown; allBranches?: unknown }
const ruleView = (r: any) => ({ id: String(r.id), weekdays: (Array.isArray(r.weekdays) ? r.weekdays : String(r.weekdays ?? '').replace(/[{}]/g, '').split(',').filter(Boolean)).map(Number).sort(),
  effectiveFrom: String(r.f), effectiveTo: r.t ? String(r.t) : null, status: String(r.status), branchId: r.branch_id ? String(r.branch_id) : null, reason: r.reason ?? null, version: N(r.version),
  createdAt: iso(r.created_at), createdBy: r.created_by_name ?? null, endedAt: iso(r.ended_at) });

export class WeeklyDaysOffRepository {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null = null) {}
  private must(ctx: TeamCtx, keys: string[], what: string) { if (!canAny(ctx, ...keys)) throw err(403, 'FORBIDDEN', `You do not have permission to ${what}.`); }
  private async tech(ctx: TeamCtx, id: unknown) {
    if (typeof id !== 'string' || !UUID.test(id)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const t = (await sql<any>`select te.id, te.full_name, te.branch_id from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${id} and te.archived_at is null`.execute(this.db)).rows[0];
    if (!t) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    return t;
  }
  private clean(body: WeeklyOffBody, today: string) {
    const days = Array.isArray(body.weekdays) ? [...new Set(body.weekdays.map((d) => Math.trunc(Number(d))))].filter((d) => d >= 0 && d <= 6).sort() : [];
    if (!days.length) throw err(422, 'WEEKLY_OFF_INVALID', 'Choose at least one weekday.', { field: 'weekdays' });
    if (Array.isArray(body.weekdays) && days.length !== new Set(body.weekdays).size) throw err(422, 'WEEKLY_OFF_INVALID', 'Weekdays are 0 (Sunday) – 6 (Saturday).', { field: 'weekdays' });
    const from = typeof body.effectiveFrom === 'string' && YMD.test(body.effectiveFrom) ? body.effectiveFrom : null;
    if (!from) throw err(422, 'WEEKLY_OFF_INVALID', 'Choose the date the pattern starts.', { field: 'effectiveFrom' });
    if (from < today) throw err(422, 'WEEKLY_OFF_INVALID', 'A new pattern starts today or later — past days keep the schedule they had.', { field: 'effectiveFrom' });
    const to = body.effectiveTo == null || body.effectiveTo === '' ? null : typeof body.effectiveTo === 'string' && YMD.test(body.effectiveTo) ? body.effectiveTo : 'bad';
    if (to === 'bad' || (to && to < from)) throw err(422, 'WEEKLY_OFF_INVALID', 'The end date must be on or after the start date.', { field: 'effectiveTo' });
    if (to && to > addLocalDays(from, 3660)) throw err(422, 'WEEKLY_OFF_INVALID', 'Choose an end date within 10 years, or "Until changed".', { field: 'effectiveTo' });
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
    return { days, from, to: to as string | null, reason };
  }
  private async rules(exec: Kysely<any>, ctx: TeamCtx, technicianId: string, lock = false) {
    return (await sql<any>`select r.id, r.weekdays, to_char(r.effective_from, 'YYYY-MM-DD') as f, to_char(r.effective_to, 'YYYY-MM-DD') as t, r.status, r.branch_id, r.reason, r.version, r.created_at, r.ended_at,
        coalesce(nullif(u.full_name, ''), u.email) as created_by_name
      from technician_weekly_off_rules r left join users u on u.id = r.created_by and u.tenant_id = r.tenant_id
      where r.tenant_id = ${ctx.tenantId} and r.technician_id = ${technicianId} order by r.effective_from desc, r.created_at desc ${lock ? sql`for update of r` : sql``}`.execute(exec)).rows;
  }
  private async weekly(ctx: TeamCtx, technicianId: string) {
    const b = branchOf(ctx);
    const rows = (await sql<any>`select distinct on (sc.day_of_week) sc.day_of_week, sc.is_working, to_char(sc.start_time, 'HH24:MI') as s, to_char(sc.end_time, 'HH24:MI') as e from technician_schedules sc
      where sc.tenant_id = ${ctx.tenantId} and sc.technician_id = ${technicianId} and (${b}::uuid is null or sc.branch_id = ${b} or sc.branch_id is null)
      order by sc.day_of_week, (sc.branch_id is null), sc.updated_at desc nulls last`.execute(this.db)).rows;
    const by = new Map<number, any>(rows.map((r: any) => [N(r.day_of_week), r]));
    return [0, 1, 2, 3, 4, 5, 6].map((d) => { const r = by.get(d); return { weekday: d, name: WEEKDAY_NAMES[d], working: r ? !!r.is_working : null, hours: r?.is_working && r.s && r.e ? `${r.s}–${r.e}` : null }; });
  }
  /** the live rule on `date` (ACTIVE and covering it) */
  private liveOn(rules: ReturnType<typeof ruleView>[], date: string) { return rules.find((r) => r.status === 'ACTIVE' && r.effectiveFrom <= date && (!r.effectiveTo || r.effectiveTo >= date)) ?? null; }

  async list(ctx: TeamCtx, q: { technicianId?: string; month?: string }) {
    this.must(ctx, VIEW, 'view technician schedules');
    const t = await this.tech(ctx, q.technicianId);
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const rules = (await this.rules(this.db, ctx, t.id)).map(ruleView);
    const current = this.liveOn(rules, per.today);
    const upcoming = rules.filter((r) => r.status === 'ACTIVE' && r.effectiveFrom > per.today);
    const history = (await sql<any>`select e.id, e.action, e.before_json, e.after_json, e.reason, e.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor from technician_weekly_off_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${ctx.tenantId} and e.technician_id = ${t.id} order by e.created_at desc, e.id desc limit 25`.execute(this.db)).rows
      .map((e: any) => ({ id: String(e.id), action: e.action, before: e.before_json ?? null, after: e.after_json ?? null, reason: e.reason ?? null, at: iso(e.created_at), actor: e.actor ?? null }));
    // month preview: each date's source (weekly rule / date override / weekly template)
    const month = typeof q.month === 'string' && /^\d{4}-\d{2}$/.test(q.month) ? q.month : per.today.slice(0, 7);
    const first = `${month}-01`; const days: string[] = [];
    for (let d = first; d.slice(0, 7) === month; d = addLocalDays(d, 1)) days.push(d);
    const b = branchOf(ctx);
    const ov = new Map<string, string>((await sql<any>`select to_char(o.local_shift_date, 'YYYY-MM-DD') as d, o.override_type from technician_shift_overrides o where o.tenant_id = ${ctx.tenantId} and o.technician_id = ${t.id}
      and (${b}::uuid is null or o.branch_id = ${b}) and o.local_shift_date between ${first}::date and ${days[days.length - 1]}::date`.execute(this.db)).rows.map((r: any) => [String(r.d), String(r.override_type)]));
    const week = await this.weekly(ctx, t.id);
    const calendar = days.map((d) => {
      const o = ov.get(d); const rule = this.liveOn(rules, d); const wk = week[weekdayOf(d)];
      const ruleOff = !!rule && rule.weekdays.includes(weekdayOf(d));
      const state = o === 'DAY_OFF' ? 'off_override' : o === 'CUSTOM_SHIFT' ? 'working_override' : ruleOff ? 'off_weekly_rule' : wk.working === false ? 'off_template' : wk.working ? 'working' : 'store_hours';
      return { date: d, state, ruleId: ruleOff ? rule!.id : null };
    });
    return { technicianId: String(t.id), name: t.full_name ?? null, today: per.today, tz: per.tz, current, upcoming, rules, history, week, month, calendar,
      version: current?.version ?? upcoming[0]?.version ?? 0, canEdit: canAny(ctx, ...EDIT) };
  }

  private async plan(ctx: TeamCtx, body: WeeklyOffBody) {
    const t = await this.tech(ctx, body.technicianId);
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const c = this.clean(body, per.today);
    const until = c.to ?? addLocalDays(c.from, HORIZON_DAYS);
    const b = branchOf(ctx);
    const appts = (await sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as d, left(a.start_time::text, 5) as s, left(a.end_time::text, 5) as e, a.status, a.customer_name
      from pos_tech_appointments a where a.tenant_id = ${ctx.tenantId} and a.technician_id = ${t.id} and a.appt_date between ${c.from}::date and ${until}::date
        and extract(dow from a.appt_date)::int = any(${c.days}::int[]) and lower(a.status) = any(${HOLDING}::text[]) and (${b}::uuid is null or a.branch_id = ${b} or a.branch_id is null)
      order by a.appt_date, a.start_time, a.id limit 200`.execute(this.db)).rows;
    // a date-specific working override on a new off day keeps that day working (shown, not a conflict)
    const keeps = (await sql<any>`select to_char(o.local_shift_date, 'YYYY-MM-DD') as d from technician_shift_overrides o where o.tenant_id = ${ctx.tenantId} and o.technician_id = ${t.id}
      and o.override_type = 'CUSTOM_SHIFT' and o.local_shift_date between ${c.from}::date and ${until}::date and extract(dow from o.local_shift_date)::int = any(${c.days}::int[])`.execute(this.db)).rows.map((r: any) => String(r.d));
    const keep = new Set(keeps);
    const conflicts = appts.filter((a: any) => !keep.has(String(a.d))).map((a: any) => ({ kind: 'BOOKING', appointmentId: String(a.id), date: String(a.d), startTime: a.s, endTime: a.e, status: String(a.status), customer: a.customer_name ?? null }));
    const week = await this.weekly(ctx, t.id);
    const rules = (await this.rules(this.db, ctx, t.id)).map(ruleView);
    const cur = this.liveOn(rules, c.from);
    const before = week.map((w) => ({ ...w, off: (cur?.weekdays.includes(w.weekday) ?? false) || w.working === false }));
    const after = week.map((w) => ({ ...w, off: c.days.includes(w.weekday) || w.working === false }));
    return { t, per, c, until, conflicts, keptWorkingDates: keeps, before, after, current: cur };
  }

  async preview(ctx: TeamCtx, body: WeeklyOffBody) {
    this.must(ctx, VIEW, 'view technician schedules');
    const p = await this.plan(ctx, body);
    return { technicianId: String(p.t.id), weekdays: p.c.days, weekdayNames: p.c.days.map((d) => WEEKDAY_NAMES[d]), effectiveFrom: p.c.from, effectiveTo: p.c.to, checkedThrough: p.until,
      before: p.before, after: p.after, conflicts: p.conflicts, keptWorkingDates: p.keptWorkingDates, blocking: p.conflicts.length > 0, current: p.current };
  }

  async save(ctx: TeamCtx, body: WeeklyOffBody, requestId: string) {
    this.must(ctx, EDIT, 'edit technician schedules');
    const p = await this.plan(ctx, body); const T = ctx.tenantId;
    if (p.conflicts.length && body.acknowledgeConflicts !== true)
      throw err(409, 'SCHEDULE_CONFLICT', `${p.conflicts.length} booking(s) fall on the new days off. Review them first — they are kept, never cancelled or moved.`, { conflicts: p.conflicts, canAcknowledge: true });
    const ev = body.expectedVersion == null || body.expectedVersion === '' ? null : Math.trunc(Number(body.expectedVersion));
    const branch = body.allBranches === true ? null : branchOf(ctx);
    const out = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'weekly-off:' + T + ':' + p.t.id}))`.execute(trx);
      const rules = (await this.rules(trx, ctx, p.t.id, true)).map(ruleView);
      const live = rules.filter((r) => r.status === 'ACTIVE' && (!r.effectiveTo || r.effectiveTo >= p.c.from));
      const curVersion = live.length ? Math.max(...live.map((r) => r.version)) : 0;
      if (ev != null && ev !== curVersion) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this technician\'s days off. Reload to see the latest.', { currentVersion: curVersion });
      // supersede: a rule that started before the new one ends the day before it; one that had not started yet ends unused
      for (const r of live) {
        const endTo = addLocalDays(p.c.from, -1);
        if (r.effectiveFrom <= endTo) await sql`update technician_weekly_off_rules set effective_to = ${endTo}::date, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now() where tenant_id = ${T} and id = ${r.id}`.execute(trx);
        else await sql`update technician_weekly_off_rules set status = 'ENDED', ended_at = now(), ended_by = ${ctx.userId ?? null}, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now() where tenant_id = ${T} and id = ${r.id} and ${canMoveToSql(TECHNICIAN_WEEKLY_OFF_RULE, 'ENDED')}`.execute(trx);
        await sql`insert into technician_weekly_off_events (created_at, tenant_id, technician_id, rule_id, action, before_json, after_json, reason, actor_user_id)
          values (clock_timestamp(), ${T}, ${p.t.id}, ${r.id}, 'SUPERSEDED', ${JSON.stringify(r)}::jsonb, ${JSON.stringify({ effectiveTo: r.effectiveFrom <= endTo ? endTo : null, status: r.effectiveFrom <= endTo ? 'ACTIVE' : 'ENDED' })}::jsonb, ${p.c.reason}, ${ctx.userId ?? null})`.execute(trx);
      }
      const version = curVersion + 1;
      const row = (await sql<any>`insert into technician_weekly_off_rules (tenant_id, branch_id, technician_id, weekdays, effective_from, effective_to, status, reason, version, created_by, updated_by)
        values (${T}, ${branch}, ${p.t.id}, ${p.c.days}::smallint[], ${p.c.from}::date, ${p.c.to}::date, 'ACTIVE', ${p.c.reason}, ${version}, ${ctx.userId ?? null}, ${ctx.userId ?? null}) returning id`.execute(trx)).rows[0];
      const after = { weekdays: p.c.days, effectiveFrom: p.c.from, effectiveTo: p.c.to, branchId: branch, version };
      const acknowledged = p.conflicts.map((c) => ({ appointmentId: c.appointmentId, date: c.date }));
      await sql`insert into technician_weekly_off_events (created_at, tenant_id, technician_id, rule_id, action, before_json, after_json, reason, actor_user_id)
        values (clock_timestamp(), ${T}, ${p.t.id}, ${row.id}, 'CREATED', ${live.length ? JSON.stringify(live) : null}::jsonb, ${JSON.stringify({ ...after, acknowledgedConflicts: acknowledged })}::jsonb, ${p.c.reason}, ${ctx.userId ?? null})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'technician.weekly_off.saved', resourceType: 'technician_weekly_off_rule', resourceId: String(row.id),
        summary: `Weekly days off set: ${p.c.days.map((d) => WEEKDAY_NAMES[d]).join(' + ')} from ${p.c.from}${p.c.to ? ` to ${p.c.to}` : ' (until changed)'}`, before: live.length ? { rules: live } : null, after, reason: p.c.reason,
        metadata: { technicianId: p.t.id, conflictsAcknowledged: acknowledged.length }, requestId });
      if (this.outbox) await this.outbox.write(trx as unknown as Parameters<OutboxWriter['write']>[0], createDomainEvent({ eventType: DOMAIN_EVENTS.TECHNICIAN_SHIFT_OVERRIDE_CHANGED, tenantId: T, branchId: branch ?? undefined,
        aggregateType: 'technician_weekly_off_rule', aggregateId: String(p.t.id), actorId: ctx.userId || undefined, actorType: 'user', payload: { technicianId: String(p.t.id), date: p.c.from, overrideType: 'WEEKLY_OFF', version } }));
      return { ruleId: String(row.id), version };
    });
    return { saved: true, ...out, ...(await this.list(ctx, { technicianId: String(p.t.id) })) };
  }

  async end(ctx: TeamCtx, body: { technicianId?: unknown; ruleId?: unknown; endFrom?: unknown; reason?: unknown; expectedVersion?: unknown }, requestId: string) {
    this.must(ctx, EDIT, 'edit technician schedules');
    const t = await this.tech(ctx, body.technicianId); const T = ctx.tenantId;
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const endFrom = typeof body.endFrom === 'string' && YMD.test(body.endFrom) ? body.endFrom : null;
    if (!endFrom || endFrom < per.today) throw err(422, 'WEEKLY_OFF_INVALID', 'Choose the first day the technician works on these weekdays again (today or later).', { field: 'endFrom' });
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
    if (typeof body.ruleId !== 'string' || !UUID.test(body.ruleId)) throw err(404, 'WEEKLY_OFF_NOT_FOUND', 'That days-off pattern was not found.');
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${'weekly-off:' + T + ':' + t.id}))`.execute(trx);
      const r = (await this.rules(trx, ctx, t.id, true)).map(ruleView).find((x) => x.id === body.ruleId);
      if (!r || r.status !== 'ACTIVE') throw err(404, 'WEEKLY_OFF_NOT_FOUND', 'That days-off pattern was not found or has already ended.');
      if (body.expectedVersion != null && Math.trunc(Number(body.expectedVersion)) !== r.version) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this pattern. Reload to see the latest.', { currentVersion: r.version });
      if (r.effectiveTo && r.effectiveTo < endFrom) throw err(422, 'WEEKLY_OFF_INVALID', `This pattern already ends on ${r.effectiveTo}.`, { field: 'endFrom' });
      const last = addLocalDays(endFrom, -1);
      if (r.effectiveFrom <= last) await sql`update technician_weekly_off_rules set effective_to = ${last}::date, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now() where tenant_id = ${T} and id = ${r.id}`.execute(trx);
      else await sql`update technician_weekly_off_rules set status = 'ENDED', ended_at = now(), ended_by = ${ctx.userId ?? null}, version = version + 1, updated_by = ${ctx.userId ?? null}, updated_at = now() where tenant_id = ${T} and id = ${r.id} and ${canMoveToSql(TECHNICIAN_WEEKLY_OFF_RULE, 'ENDED')}`.execute(trx);
      await sql`insert into technician_weekly_off_events (created_at, tenant_id, technician_id, rule_id, action, before_json, after_json, reason, actor_user_id)
        values (clock_timestamp(), ${T}, ${t.id}, ${r.id}, 'ENDED', ${JSON.stringify(r)}::jsonb, ${JSON.stringify({ worksAgainFrom: endFrom })}::jsonb, ${reason}, ${ctx.userId ?? null})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: 'technician.weekly_off.ended', resourceType: 'technician_weekly_off_rule', resourceId: r.id,
        summary: `Weekly days off removed from ${endFrom}`, before: r, after: { worksAgainFrom: endFrom }, reason, metadata: { technicianId: t.id }, requestId });
      if (this.outbox) await this.outbox.write(trx as unknown as Parameters<OutboxWriter['write']>[0], createDomainEvent({ eventType: DOMAIN_EVENTS.TECHNICIAN_SHIFT_OVERRIDE_CHANGED, tenantId: T, branchId: r.branchId ?? undefined,
        aggregateType: 'technician_weekly_off_rule', aggregateId: String(t.id), actorId: ctx.userId || undefined, actorType: 'user', payload: { technicianId: String(t.id), date: endFrom, overrideType: 'WEEKLY_OFF', version: r.version + 1 } }));
    });
    return { ended: true, ...(await this.list(ctx, { technicianId: String(t.id) })) };
  }
}
