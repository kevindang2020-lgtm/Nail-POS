// shift-override.repository.ts — F4 (Finish the Five, 30 Oct 2026): Edit Shift for Selected Date on the Live Technician
// Schedule. One override per technician / salon-local date / branch (technician_shift_overrides); the weekly template
// (technician_schedules) is READ for the side-by-side baseline and never written.
//
//   editor   baseline (weekly template for that weekday) · the saved override (version) · the effective day · last night's
//            overnight carry · that day's bookings · approved time off · today's active queue · the month's override dates
//   preview  validation + conflict list for an unsaved edit (nothing written)
//   save     CUSTOM_SHIFT | DAY_OFF upsert, RESTORE_BASELINE removes the override — each with expectedVersion (409 on a
//            stale version or when someone else created / removed it), a 409 SCHEDULE_CONFLICT listing every conflict until
//            the manager acknowledges it (a cross-branch overlap can never be acknowledged), and in ONE transaction: the
//            override row, its append-only history row (before → after), the central audit row and the outbox event
//            (technician.shift_override_changed → technician_schedule_updated for the branch room and the technician's own
//            room: Staff Schedule, Booking availability, Tech Queue and the Technician App refetch). Bookings are never
//            cancelled, shortened or moved.
import { sql, type Kysely } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { effectiveDaySchedule, addLocalDays, type ShiftOverride, type PBTechDaySchedule } from '@aipowersalon/booking';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { N, iso, branchOf, teamPeriod, UUID, err, canAny, type TeamCtx } from './screen-kit';
import { writeAuditRow } from './audit-rows';
import { normalize, evaluateConflicts, shiftInstants, OverrideValidationError, minutes, type Proposed, type Conflict } from './shift-override';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const VIEW = ['pos.technicians.view', 'pos.technicians.schedule.edit'];
const EDIT = ['pos.technicians.schedule.edit'];
export interface SaveBody extends Proposed { technicianId?: unknown; localDate?: unknown; reason?: unknown; expectedVersion?: unknown; acknowledgeConflicts?: unknown }

const hm = (v: unknown) => (v == null ? null : String(v).slice(0, 5));
function overrideOf(r: any): ShiftOverride | null {
  if (!r) return null;
  return { technicianId: String(r.technician_id), localDate: String(r.d), overrideType: r.override_type, startLocalTime: hm(r.s), endLocalTime: hm(r.e), endsNextDay: !!r.ends_next_day,
    breaks: Array.isArray(r.breaks_json) ? r.breaks_json : [], version: N(r.version) };
}

export class ShiftOverrideRepository {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null = null) {}
  private must(ctx: TeamCtx, keys: string[], what: string) { if (!canAny(ctx, ...keys)) throw err(403, 'FORBIDDEN', `You do not have permission to ${what}.`); }
  private branch(ctx: TeamCtx) { const b = branchOf(ctx); if (!b) throw err(422, 'BRANCH_REQUIRED', 'Choose a branch first — a date shift belongs to one branch.'); return b; }

  private async tech(ctx: TeamCtx, id: string) {
    if (!UUID.test(id)) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    const t = (await sql<any>`select te.id, te.full_name, te.branch_id, te.status from technicians te where te.tenant_id = ${ctx.tenantId} and te.id = ${id} and te.archived_at is null`.execute(this.db)).rows[0];
    if (!t) throw err(404, 'TECHNICIAN_NOT_FOUND', 'That technician is not in this salon.');
    return t;
  }
  private async baseline(ctx: TeamCtx, technicianId: string, date: string): Promise<PBTechDaySchedule | null> {
    const b = branchOf(ctx);
    const r = (await sql<any>`select sc.is_working, to_char(sc.start_time, 'HH24:MI') as s, to_char(sc.end_time, 'HH24:MI') as e, to_char(sc.lunch_start_time, 'HH24:MI') as ls, to_char(sc.lunch_end_time, 'HH24:MI') as le, sc.shifts, sc.breaks
      from technician_schedules sc where sc.tenant_id = ${ctx.tenantId} and sc.technician_id = ${technicianId} and sc.day_of_week = extract(dow from ${date}::date) and (${b}::uuid is null or sc.branch_id = ${b} or sc.branch_id is null)
      order by (sc.branch_id is null), sc.updated_at desc nulls last limit 1`.execute(this.db)).rows[0];
    if (!r) return null;
    return { isWorking: !!r.is_working, startTime: r.s, endTime: r.e, lunchStartTime: r.ls, lunchEndTime: r.le, shifts: Array.isArray(r.shifts) && r.shifts.length ? r.shifts : null, breaks: Array.isArray(r.breaks) && r.breaks.length ? r.breaks : null };
  }
  private async overrideRow(exec: Kysely<any>, ctx: TeamCtx, branchId: string, technicianId: string, date: string, lock = false) {
    const r = (await sql<any>`select o.id, o.technician_id, o.override_type, o.ends_next_day, o.breaks_json, o.note, o.version, o.updated_at, to_char(o.local_shift_date, 'YYYY-MM-DD') as d, to_char(o.start_local_time, 'HH24:MI') as s, to_char(o.end_local_time, 'HH24:MI') as e
      from technician_shift_overrides o where o.tenant_id = ${ctx.tenantId} and o.branch_id = ${branchId} and o.technician_id = ${technicianId} and o.local_shift_date = ${date}::date ${lock ? sql`for update` : sql``}`.execute(exec)).rows[0];
    return r ?? null;
  }

  private async context(ctx: TeamCtx, technicianId: string, date: string, overnight: boolean) {
    const T = ctx.tenantId; const b = this.branch(ctx); const next = addLocalDays(date, 1);
    const per = await teamPeriod(this.db, ctx, { preset: 'today' });
    const dayStart = localDateTimeToEpochMs(date, '00:00', per.tz), dayEnd = localDateTimeToEpochMs(addLocalDays(date, 2), '00:00', per.tz);
    const [appts, off, queue, other] = await Promise.all([
      sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as d, a.start_time, a.end_time, a.status, a.customer_name from pos_tech_appointments a
        where a.tenant_id = ${T} and a.technician_id = ${technicianId} and (a.branch_id = ${b} or a.branch_id is null) and a.appt_date = any(${overnight ? [date, next] : [date]}::date[])
        order by a.appt_date, a.start_time, a.id`.execute(this.db),
      sql<any>`select tf.id, tf.starts_at, tf.ends_at, tf.kind from technician_time_off tf where tf.tenant_id = ${T} and tf.technician_id = ${technicianId} and tf.status = 'approved'
        and tf.starts_at < ${new Date(dayEnd)} and tf.ends_at > ${new Date(dayStart)}`.execute(this.db),
      date === per.today ? sql<any>`select qt.id, qt.status from pos_tech_queue_tickets qt where qt.tenant_id = ${T} and qt.assigned_technician_id = ${technicianId} and qt.status in ('accepted', 'ready_to_start', 'in_service', 'paused', 'delayed')`.execute(this.db) : Promise.resolve({ rows: [] as { id: string; status: string }[] }),
      sql<any>`select o.branch_id, o.override_type, to_char(o.start_local_time, 'HH24:MI') as s, to_char(o.end_local_time, 'HH24:MI') as e, o.ends_next_day from technician_shift_overrides o
        where o.tenant_id = ${T} and o.technician_id = ${technicianId} and o.local_shift_date = ${date}::date and o.branch_id <> ${b} and o.override_type = 'CUSTOM_SHIFT'`.execute(this.db),
    ]);
    return { per, next, b,
      appointments: appts.rows.map((a: any) => ({ id: String(a.id), date: String(a.d), startTime: String(a.start_time).slice(0, 5), endTime: String(a.end_time).slice(0, 5), status: String(a.status), customer: a.customer_name ?? null })),
      timeOff: off.rows.map((t: any) => ({ id: String(t.id), startsAtMs: new Date(t.starts_at).getTime(), endsAtMs: new Date(t.ends_at).getTime(), kind: t.kind ?? null })),
      activeQueue: queue.rows.map((q: any) => ({ id: String(q.id), status: String(q.status) })),
      otherBranch: other.rows.map((o: any) => { const s = minutes(String(o.s)); const e = minutes(String(o.e)); return { branchId: String(o.branch_id), window: { start: s, end: o.ends_next_day ? e + 1440 : e } }; }) };
  }

  /** the editor: baseline vs saved override vs effective, plus what the day already holds */
  async editor(ctx: TeamCtx, q: { technicianId?: string; date?: string }) {
    this.must(ctx, VIEW, 'view technician schedules'); const b = this.branch(ctx);
    const t = await this.tech(ctx, String(q.technicianId ?? '')); const date = String(q.date ?? '');
    if (!YMD.test(date)) throw err(422, 'INVALID_DATE', 'Choose a date.');
    const [base, row, prevRow] = await Promise.all([this.baseline(ctx, t.id, date), this.overrideRow(this.db, ctx, b, t.id, date), this.overrideRow(this.db, ctx, b, t.id, addLocalDays(date, -1))]);
    const ov = overrideOf(row); const prev = overrideOf(prevRow);
    const cx = await this.context(ctx, t.id, date, !!ov?.endsNextDay);
    const eff = effectiveDaySchedule(base, ov, prev);
    const month = date.slice(0, 7);
    const marks = (await sql<any>`select to_char(o.local_shift_date, 'YYYY-MM-DD') as d, o.override_type from technician_shift_overrides o where o.tenant_id = ${ctx.tenantId} and o.branch_id = ${b} and o.technician_id = ${t.id}
      and to_char(o.local_shift_date, 'YYYY-MM') = ${month} order by o.local_shift_date`.execute(this.db)).rows;
    const history = (await sql<any>`select e.id, e.action, e.before_json, e.after_json, e.reason, e.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor from technician_shift_override_events e
      left join users u on u.id = e.actor_user_id and u.tenant_id = e.tenant_id where e.tenant_id = ${ctx.tenantId} and e.technician_id = ${t.id} and e.local_shift_date = ${date}::date
      order by e.created_at desc, e.id desc limit 10`.execute(this.db)).rows;
    return { technician: { technicianId: String(t.id), name: t.full_name ?? null }, date, tz: cx.per.tz, today: cx.per.today, past: date < cx.per.today, canEdit: canAny(ctx, ...EDIT) && date >= cx.per.today,
      baseline: base, override: ov ? { ...ov, note: row.note ?? null, updatedAt: iso(row.updated_at) } : null, previousNightCarry: prev?.endsNextDay ? { endLocalTime: prev.endLocalTime } : null, effective: eff ?? null,
      appointments: cx.appointments, timeOff: cx.timeOff.map((x) => ({ id: x.id, startsAt: new Date(x.startsAtMs).toISOString(), endsAt: new Date(x.endsAtMs).toISOString(), kind: x.kind })), activeQueue: cx.activeQueue,
      month: { month, overrides: marks.map((m: any) => ({ date: String(m.d), type: String(m.override_type) })) },
      history: history.map((h: any) => ({ id: String(h.id), action: String(h.action), before: h.before_json ?? null, after: h.after_json ?? null, reason: h.reason ?? null, at: iso(h.created_at), actor: h.actor ?? null })) };
  }

  private async plan(ctx: TeamCtx, body: SaveBody) {
    const t = await this.tech(ctx, String(body.technicianId ?? '')); const date = String(body.localDate ?? '');
    if (!YMD.test(date) || Number.isNaN(Date.parse(date))) throw err(422, 'INVALID_DATE', 'Choose a valid date.');
    let n: ReturnType<typeof normalize>;
    try { n = normalize({ overrideType: body.overrideType, startLocalTime: body.startLocalTime, endLocalTime: body.endLocalTime, endsNextDay: body.endsNextDay, breaks: body.breaks }); }
    catch (e) { if (e instanceof OverrideValidationError) throw err(422, e.code, e.message); throw e; }
    const b = this.branch(ctx);
    const base = await this.baseline(ctx, t.id, date);
    const prev = overrideOf(await this.overrideRow(this.db, ctx, b, t.id, addLocalDays(date, -1)));
    // what the day would be: RESTORE → the template; DAY_OFF → nothing; CUSTOM → the window
    const proposedOverride: ShiftOverride | null = body.overrideType === 'RESTORE_BASELINE' ? null
      : { technicianId: t.id, localDate: date, overrideType: body.overrideType as 'CUSTOM_SHIFT' | 'DAY_OFF', startLocalTime: n.start, endLocalTime: n.end, endsNextDay: n.endsNextDay, breaks: n.breakRows, version: 0 };
    const eff = effectiveDaySchedule(base, proposedOverride, prev);
    const working = body.overrideType === 'CUSTOM_SHIFT' ? n.working : this.windowsOf(eff, prev);
    const breaks = body.overrideType === 'CUSTOM_SHIFT' ? n.breaks : (eff?.breaks ?? []).map((x) => ({ start: minutes(x.startTime), end: minutes(x.endTime), type: x.type }));
    const cx = await this.context(ctx, t.id, date, n.endsNextDay);
    if (date < cx.per.today) throw err(422, 'PAST_DATE', 'A past date cannot be edited.');
    const conflicts = evaluateConflicts({ date, tz: cx.per.tz, today: cx.per.today, nowMinute: cx.per.nowMinute, proposed: { working, breaks }, appointments: cx.appointments, timeOff: cx.timeOff, activeQueue: cx.activeQueue,
      otherBranch: body.overrideType === 'CUSTOM_SHIFT' ? cx.otherBranch : [] }, cx.next);
    return { t, date, n, b, base, eff, conflicts, instants: shiftInstants(date, working[working.length - 1], cx.per.tz, cx.next), tz: cx.per.tz };
  }
  private windowsOf(eff: PBTechDaySchedule | null | undefined, _prev: ShiftOverride | null) {
    if (!eff || eff.isWorking === false) return [];
    const list = eff.shifts?.length ? eff.shifts : eff.startTime && eff.endTime ? [{ startTime: eff.startTime, endTime: eff.endTime }] : [{ startTime: '00:00', endTime: '24:00' }];
    return list.map((s) => ({ start: s.startTime === '24:00' ? 1440 : minutes(s.startTime), end: s.endTime === '24:00' ? 1440 : minutes(s.endTime) }));
  }

  async preview(ctx: TeamCtx, body: SaveBody) {
    this.must(ctx, VIEW, 'view technician schedules');
    const p = await this.plan(ctx, body);
    return { technicianId: String(p.t.id), date: p.date, tz: p.tz, overrideType: body.overrideType, baseline: p.base, effective: p.eff ?? null, conflicts: p.conflicts, instants: p.instants,
      blocking: p.conflicts.some((c) => c.blocking), canAcknowledge: !p.conflicts.some((c) => c.kind === 'CROSS_BRANCH') };
  }

  async save(ctx: TeamCtx, body: SaveBody, requestId: string) {
    this.must(ctx, EDIT, 'edit technician schedules');
    const p = await this.plan(ctx, body); const T = ctx.tenantId;
    const hard = p.conflicts.filter((c) => c.kind === 'CROSS_BRANCH');
    if (hard.length) throw err(409, 'SCHEDULE_CONFLICT', 'This technician already works at another branch at that time.', { conflicts: p.conflicts, canAcknowledge: false });
    if (p.conflicts.some((c) => c.blocking) && body.acknowledgeConflicts !== true) throw err(409, 'SCHEDULE_CONFLICT', 'This change conflicts with bookings or the queue. Review the conflicts first.', { conflicts: p.conflicts, canAcknowledge: true });
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
    const ev = body.expectedVersion == null || body.expectedVersion === '' ? null : Number(body.expectedVersion);
    const out = await this.db.transaction().execute(async (trx) => {
      const cur = await this.overrideRow(trx, ctx, p.b, p.t.id, p.date, true);
      // concurrency: an existing override needs its version; "no override" must still be true when saving a new one
      if (cur && (ev == null || N(cur.version) !== ev)) throw err(409, 'VERSION_CONFLICT', 'Someone else changed this date. Reload to see the latest.', { currentVersion: N(cur.version) });
      if (!cur && ev != null && ev > 0) throw err(409, 'VERSION_CONFLICT', 'The override you were editing was removed. Reload to see the latest.', { currentVersion: 0 });
      const before = cur ? { overrideType: cur.override_type, start: cur.s ?? null, end: cur.e ?? null, endsNextDay: !!cur.ends_next_day, breaks: cur.breaks_json ?? [], version: N(cur.version) } : null;
      let after: Record<string, unknown> | null = null; let version = 0;
      if (body.overrideType === 'RESTORE_BASELINE') {
        if (!cur) throw err(422, 'NOTHING_TO_RESTORE', 'This date already follows the recurring schedule.');
        await sql`delete from technician_shift_overrides o where o.tenant_id = ${T} and o.id = ${cur.id}`.execute(trx);
      } else {
        const row = (await sql<any>`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type, start_local_time, end_local_time, ends_next_day, breaks_json, note, version, created_by, updated_by)
            values (${T}, ${p.b}, ${p.t.id}, ${p.date}::date, ${p.tz}, ${body.overrideType}, ${p.n.start}::time, ${p.n.end}::time, ${p.n.endsNextDay}, ${JSON.stringify(p.n.breakRows)}::jsonb, ${reason}, 1, ${ctx.userId ?? null}, ${ctx.userId ?? null})
          on conflict (tenant_id, branch_id, technician_id, local_shift_date) do update set override_type = excluded.override_type, start_local_time = excluded.start_local_time, end_local_time = excluded.end_local_time,
            ends_next_day = excluded.ends_next_day, breaks_json = excluded.breaks_json, note = excluded.note, timezone = excluded.timezone, version = technician_shift_overrides.version + 1, updated_by = excluded.updated_by, updated_at = now()
          returning version`.execute(trx)).rows[0];
        version = N(row.version);
        after = { overrideType: body.overrideType, start: p.n.start, end: p.n.end, endsNextDay: p.n.endsNextDay, breaks: p.n.breakRows, version };
      }
      const acknowledged = p.conflicts.map((c: Conflict) => ({ kind: c.kind, appointmentId: c.appointmentId ?? null, date: c.date ?? null, startTime: c.startTime ?? null, endTime: c.endTime ?? null }));
      const action = body.overrideType === 'RESTORE_BASELINE' ? 'RESTORED_BASELINE' : 'SAVED';
      await sql`insert into technician_shift_override_events (tenant_id, branch_id, technician_id, local_shift_date, action, before_json, after_json, reason, actor_user_id, request_id)
        values (${T}, ${p.b}, ${p.t.id}, ${p.date}::date, ${action}, ${before ? JSON.stringify(before) : null}::jsonb, ${after ? JSON.stringify({ ...after, acknowledgedConflicts: acknowledged }) : JSON.stringify({ acknowledgedConflicts: acknowledged })}::jsonb, ${reason}, ${ctx.userId ?? null}, ${requestId})`.execute(trx);
      await writeAuditRow(trx, ctx, { module: 'workforce', action: action === 'SAVED' ? 'technician.shift_override.saved' : 'technician.shift_override.restored', resourceType: 'technician_shift_override', resourceId: `${p.t.id}:${p.date}`,
        summary: `${action === 'SAVED' ? 'Date shift saved' : 'Recurring shift restored'} for ${p.date}`, before, after, reason, metadata: { technicianId: p.t.id, date: p.date, conflictsAcknowledged: acknowledged.length }, requestId });
      if (this.outbox) await this.outbox.write(trx as unknown as Parameters<OutboxWriter['write']>[0], createDomainEvent({ eventType: DOMAIN_EVENTS.TECHNICIAN_SHIFT_OVERRIDE_CHANGED, tenantId: T, branchId: p.b, aggregateType: 'technician_shift_override',
        aggregateId: p.t.id, actorId: ctx.userId || undefined, actorType: 'user', payload: { technicianId: p.t.id, date: p.date, overrideType: body.overrideType, version } }));
      return { version };
    });
    return { saved: true, version: out.version, ...(await this.editor(ctx, { technicianId: String(p.t.id), date: p.date })) };
  }
}
