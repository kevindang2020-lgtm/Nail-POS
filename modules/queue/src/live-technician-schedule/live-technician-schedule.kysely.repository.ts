// live-technician-schedule.kysely.repository.ts — production aggregation over Postgres (Kysely). This composes the
// REAL existing tables into the live board; it owns no appointment/shift/status data of its own:
//   roster        → technicians
//   shift (today) → technician_schedules (by day_of_week)
//   live status   → technician_workforce_state (579, the ONE authoritative state; legacy technician_statuses fallback for a
//                   technician with no workforce row yet) — merge Oct 12 2026
//   time off      → technician_time_off (528/582): APPROVED leave covering the day removes that day's shift
//   skills        → technician_services → services → service_categories
//   appointments  → pos_tech_appointments (shared with tech-appointments / booking — no duplicate table)
//   blocks        → technician_blocked_times (new)
//   sales/comm    → ticket_compensation_snapshots (the payroll authority), branch-scoped, branch civil day (Oct 13 2026)
// Mutations write technician_blocked_times / technician_statuses (+ technician_status_events) / pos_tech_appointments,
// each with an audit_logs row. Scope is session-derived (tenant + branch-or-null); the client never supplies tenant.
import { AppointmentWriter } from '@aipowersalon/appointments';
import { foldVi } from '@aipowersalon/api-contracts';
import type { OutboxWriter } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import { writeAppointmentSlot } from '@aipowersalon/appointments';
import { businessDate, zonedParts, localDateTimeToEpochMs, addDays } from '@aipowersalon/date-time';
import type { LiveScheduleRepositoryPort, LiveScheduleContext } from './live-technician-schedule.repository';
import { CompensationSnapshotRepository } from '@aipowersalon/workforce';
import { buildMediaUrl } from '@aipowersalon/media';
import {
  LiveTechnicianScheduleState, LiveTechnicianScheduleKpis, LiveTechnicianDetail, LiveTechnicianColumn, LiveScheduleAppointment, LiveScheduleOpenSlot,
  LiveScheduleFilters, BlockTechnicianTimeRequest, LiveApptSource, LiveShift, LIVE_STATUS_LABEL, LiveTechStatus,
  lsInitials, lsDayOfWeek, lsComputeOpenSlots, lsBookedMinutes, lsShiftMinutes, lsUtilization, lsNormalizeStatus, lsRollupKpis,
  lsMinutesOf, lsToHHMM, lsMapApptStatus, type LiveClockState,
} from './live-technician-schedule.dto';

const RANGE = { startTime: '09:00', endTime: '19:00', slotMinutes: 30 };
/** technician_workforce_state.queue_status (579) → the board's raw status vocabulary (lsNormalizeStatus). */
const WORKFORCE_TO_BOARD: Record<string, string> = { SERVING: 'in_service', BREAK: 'on_break', ASSIGNED: 'assigned', AVAILABLE: 'available', UNAVAILABLE: 'offline', OFF_SHIFT: 'off_shift' };
const parseServices = (v: any): any[] => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };

type TechRow = { id: string; user_id: string | null; full_name: string; role_label: string | null; tech_avatar_url: string | null; gtp_avatar_url: string | null; user_avatar_url: string | null; phone_display: string | null };
type Bundle = { techs: TechRow[]; skillsBy: Record<string, string[]>; statusBy: Record<string, string>; clockBy: Record<string, LiveClockState>; punchShift: Set<string>; shiftBy: Record<string, LiveShift | undefined>; apptsBy: Record<string, LiveScheduleAppointment[]>; blocksBy: Record<string, { blockId: string; startTime: string; endTime: string; reason: string; note?: string }[]>; nowMinutes: number };

/** the booking engine's default buffer (DEFAULT_BOOKING_SETTINGS.bufferMinutes) when the salon saved none */
const LS_DEFAULT_BUFFER_MINUTES = 5;

export class KyselyLiveScheduleRepository implements LiveScheduleRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  private readonly writer = new AppointmentWriter(this.outbox);
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /**
   * The BRANCH's day and time of day (Oct 6 2026). These were the server's UTC date and clock: after 8 pm in New York
   * the board opened on tomorrow, and "blocked now" / "next appointment" compared against UTC minutes.
   */
  private async clock(ctx: LiveScheduleContext): Promise<{ date: string; minutes: number }> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId); const now = new Date(this.now()); const p = zonedParts(now, tz);
    return { date: businessDate(tz, now), minutes: p.hour * 60 + p.minute };
  }
  async today(ctx: LiveScheduleContext) { return (await this.clock(ctx)).date; }
  async nowMinutes(ctx: LiveScheduleContext) { return (await this.clock(ctx)).minutes; }

  private scoped(qb: any, ctx: LiveScheduleContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }

  /** 200-technician §2 remainder (Nov 5 2026): one page-state read asked for the same salon day THREE times (board, KPIs,
   *  filters — run together), each reading the whole roster's skills / states / shifts / appointments / blocks / punches.
   *  Concurrent callers for the same tenant + branch + day now share ONE in-flight read; nothing is cached after it
   *  settles, so a write is never hidden behind a stale copy. */
  private readonly inflight = new Map<string, Promise<Bundle>>();
  private load(ctx: LiveScheduleContext, date: string): Promise<Bundle> {
    const key = `${ctx.tenantId}|${ctx.branchId}|${date}`;
    const hit = this.inflight.get(key);
    if (hit) return hit;
    const p = this.loadDay(ctx, date).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }
  private async loadDay(ctx: LiveScheduleContext, date: string): Promise<Bundle> {
    const techs = await this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech')
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .where('tech.status', '!=', 'archived')
      .select(['tech.id', 'tech.user_id', 'tech.full_name', 'tech.role_label', 'tech.phone_display',
        'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'
      ]).execute().catch(() => []) as TechRow[];
    const ids = techs.map((t) => t.id);
    const dow = lsDayOfWeek(date);
    const [skillRows, statRows, shiftRows, apptRows, blockRows, punchRows] = await Promise.all([
      ids.length ? this.scoped(this.db.selectFrom('technician_services as ts'), ctx, 'ts').innerJoin('services as s', 's.id', 'ts.service_id').leftJoin('service_categories as c', 'c.id', 's.category_id').where('ts.technician_id', 'in', ids).select(['ts.technician_id as tid', 'c.name as cat']).execute().catch(() => []) : Promise.resolve([]),
      ids.length ? this.db.selectFrom('technician_workforce_state').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', ids).select(['technician_id', 'queue_status', 'clock_status', 'service_state']).execute().catch(() => []) : Promise.resolve([]),
      ids.length ? this.scoped(this.db.selectFrom('technician_schedules'), ctx).where('technician_id', 'in', ids).where('day_of_week', '=', dow).select(['technician_id', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working']).execute().catch(() => []) : Promise.resolve([]),
      this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date).select(['id', 'technician_id', 'customer_id', 'customer_name', 'services', 'start_time', 'end_time', 'status', 'source']).execute().catch(() => []),
      this.scoped(this.db.selectFrom('technician_blocked_times'), ctx).where('block_date', '=', date).select(['id', 'technician_id', 'start_time', 'end_time', 'reason', 'note']).execute().catch(() => []),
      // today's shift rows + any OPEN active punch (end_time null) whatever its shift_date — a clocked-in technician is never hidden (merge Oct 12 2026)
      ids.length ? this.scoped(this.db.selectFrom('technician_shifts'), ctx).where('technician_id', 'in', ids).where((eb: any) => eb.or([eb('shift_date', '=', date), eb.and([eb('end_time', 'is', null), eb('status', '=', 'active')])])).select(['technician_id', 'start_time', 'end_time', 'status']).execute().catch(() => []) : Promise.resolve([]),
    ]);
    const custIds = [...new Set((apptRows as any[]).map((a) => a.customer_id).filter(Boolean))];
    const custRows = custIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const custAvatarMap: Record<string, string> = {};
    for (const c of custRows) { if (c.id && c.avatar_url) custAvatarMap[c.id] = c.avatar_url; }
    const skillsBy: Record<string, string[]> = {}; for (const r of skillRows) { (skillsBy[r.tid] ||= []); if (r.cat && !skillsBy[r.tid].includes(r.cat)) skillsBy[r.tid].push(r.cat); }
    // ONE authoritative state (579) → the board vocabulary; technicians with no workforce row yet fall back to the legacy row.
    const statusBy: Record<string, string> = {};
    for (const r of statRows) statusBy[r.technician_id] = WORKFORCE_TO_BOARD[String(r.queue_status)] ?? 'off_shift';
    // Shift-vs-Clock-In (extras): physical presence from the ONE time clock (579) beside the planned shift — never inferred
    const clockBy: Record<string, LiveClockState> = {};
    for (const r of statRows) clockBy[r.technician_id] = r.clock_status === 'CLOCKED_IN' ? 'clocked_in' : r.clock_status === 'ON_BREAK' ? 'on_break' : r.clock_status === 'CLOCKED_OUT' ? 'clocked_out' : null;
    const punchShift = new Set<string>();
    const noState = ids.filter((id) => !statusBy[id]);
    if (noState.length) {
      const legacy = await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', noState).select(['technician_id', 'status', 'changed_at']).orderBy('changed_at', 'asc').execute().catch(() => []);
      for (const r of legacy) statusBy[r.technician_id] = r.status;   // asc → last wins = latest
    }
    // APPROVED time off covering this salon-local day removes the day's shift (an open punch still shows the technician).
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
    const offToday = new Set<string>();
    if (ids.length) {
      const dayStart = new Date(localDateTimeToEpochMs(date, '00:00', tz)), dayEnd = new Date(localDateTimeToEpochMs(addDays(date, 1), '00:00', tz));
      let to = this.db.selectFrom('technician_time_off').select(['technician_id']).where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', ids)
        .where('status', '=', 'approved').where('starts_at', '<', dayEnd).where('ends_at', '>', dayStart);
      if (ctx.branchId) to = to.where((eb) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
      for (const r of await to.execute().catch(() => [] as any[])) offToday.add(String((r as any).technician_id));
    }
    // G3 (Nov 5 2026, migration 816): a manager's repeating weekly day off removes the weekly shift for this date (the
    // same precedence as Booking: a date override below still wins; an open punch still shows the technician)
    const weeklyOff = new Set<string>();
    if (ids.length) {
      const wo = (await sql<any>`select distinct r.technician_id from technician_weekly_off_rules r where r.tenant_id = ${ctx.tenantId} and r.status = 'ACTIVE'
          and r.technician_id = any(${ids}::uuid[]) and (${ctx.branchId ?? null}::uuid is null or r.branch_id is null or r.branch_id = ${ctx.branchId ?? null}::uuid)
          and r.effective_from <= ${date}::date and (r.effective_to is null or r.effective_to >= ${date}::date) and extract(dow from ${date}::date)::smallint = any(r.weekdays)`.execute(this.db)).rows;
      for (const r of wo) weeklyOff.add(String(r.technician_id));
    }
    const shiftBy: Record<string, LiveShift | undefined> = {};
    for (const r of shiftRows) shiftBy[r.technician_id] = r.is_working && !offToday.has(r.technician_id) && !weeklyOff.has(r.technician_id) ? { startTime: (r.start_time || '09:00').slice(0, 5), endTime: (r.end_time || '18:00').slice(0, 5), breakStartTime: r.lunch_start_time ? r.lunch_start_time.slice(0, 5) : undefined, breakEndTime: r.lunch_end_time ? r.lunch_end_time.slice(0, 5) : undefined } : undefined;
    // F4 (Oct 30 2026): a date-specific override (technician_shift_overrides) beats the weekly template for this date —
    // DAY_OFF removes the shift, CUSTOM_SHIFT replaces start / end / break. Approved time off still wins; punches still show.
    if (ids.length && ctx.branchId) {
      const ov = (await sql<any>`select o.technician_id, o.override_type, to_char(o.start_local_time, 'HH24:MI') as s, to_char(o.end_local_time, 'HH24:MI') as e, o.ends_next_day, o.breaks_json
        from technician_shift_overrides o where o.tenant_id = ${ctx.tenantId} and o.branch_id = ${ctx.branchId} and o.local_shift_date = ${date} and o.technician_id = any(${ids}::uuid[])`.execute(this.db).catch(() => ({ rows: [] as Record<string, any>[] }))).rows;
      for (const o of ov) {
        const tid = String(o.technician_id); const br = Array.isArray(o.breaks_json) ? o.breaks_json[0] : null;
        shiftBy[tid] = o.override_type === 'DAY_OFF' || offToday.has(tid) ? undefined
          : { startTime: String(o.s), endTime: o.ends_next_day ? '23:59' : String(o.e), breakStartTime: br?.startLocalTime ?? undefined, breakEndTime: br?.endLocalTime ?? undefined };
      }
    }
    for (const p of punchRows) {
      if (!p.technician_id) continue;
      const isActive = !p.end_time || p.status === 'active' || p.status === 'clocked_in';
      if (isActive) {
        if (!(p.technician_id in clockBy)) clockBy[p.technician_id] = 'clocked_in';   // no workforce row: the open punch is the clock
        if (!shiftBy[p.technician_id]) {
          punchShift.add(p.technician_id);   // the board shows the punch as a shift — it is NOT a scheduled one
          const st = p.start_time ? (() => { const z = zonedParts(new Date(p.start_time), tz); return lsToHHMM(z.hour * 60 + z.minute); })() : '09:00';   // the branch's clock (was the UTC hour)
          shiftBy[p.technician_id] = { startTime: st, endTime: '19:00' };
        }
        // An open punch only upgrades a LEGACY 'off_shift' — the workforce row (when present) is authoritative.
        if (!statusBy[p.technician_id] || (statusBy[p.technician_id] === 'off_shift' && noState.includes(p.technician_id))) {
          statusBy[p.technician_id] = 'available';
        }
      }
    }
    const apptsBy: Record<string, LiveScheduleAppointment[]> = {};
    for (const a of apptRows) {
      if (!a.technician_id) continue;
      const svc = parseServices(a.services).map((x: any) => x.serviceName).filter(Boolean).join(', ') || 'Service';
      const custPhoto = a.customer_id ? custAvatarMap[a.customer_id] : null;
      (apptsBy[a.technician_id] ||= []).push({ appointmentId: a.id, customerId: a.customer_id || undefined, customerName: a.customer_name || 'Guest', customerInitials: lsInitials(a.customer_name || 'Guest'), avatarUrl: custPhoto ? buildMediaUrl(custPhoto) : null, customerAvatarUrl: custPhoto ? buildMediaUrl(custPhoto) : null, serviceSummary: svc, startTime: (a.start_time||'').slice(0,5), endTime: (a.end_time||'').slice(0,5), status: lsMapApptStatus(a.status), source: (a.source as LiveApptSource) || 'pos', ticketId: undefined });
    }
    for (const k of Object.keys(apptsBy)) apptsBy[k].sort((x, y) => lsMinutesOf(x.startTime) - lsMinutesOf(y.startTime));
    const blocksBy: Record<string, { blockId: string; startTime: string; endTime: string; reason: string; note?: string }[]> = {};
    for (const b of blockRows) (blocksBy[b.technician_id] ||= []).push({ blockId: b.id, startTime: b.start_time, endTime: b.end_time, reason: b.reason, note: b.note || undefined });
    return { techs, skillsBy, statusBy, clockBy, punchShift, shiftBy, apptsBy, blocksBy, nowMinutes: await this.nowMinutes(ctx) };
  }

  /** The shared day is read once; each technician's column is computed once per read too (board + KPIs used to build every column twice). */
  private readonly columns = new WeakMap<Bundle, Map<string, LiveTechnicianColumn>>();
  private column(b: Bundle, t: TechRow): LiveTechnicianColumn {
    let m = this.columns.get(b); if (!m) { m = new Map(); this.columns.set(b, m); }
    const hit = m.get(t.id); if (hit) return hit;
    const c = this.buildColumn(b, t); m.set(t.id, c); return c;
  }
  private buildColumn(b: Bundle, t: TechRow): LiveTechnicianColumn {
    const shift = b.shiftBy[t.id]; const appts = b.apptsBy[t.id] || []; const blocks = b.blocksBy[t.id] || [];
    const status = lsNormalizeStatus(b.statusBy[t.id], !!shift, appts, blocks, b.nowMinutes);
    const busy = [...appts.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').map((a) => ({ startTime: a.startTime, endTime: a.endTime })), ...blocks.map((x) => ({ startTime: x.startTime, endTime: x.endTime }))];
    const openSlots = lsComputeOpenSlots(t.id, shift, busy, RANGE.slotMinutes);
    const bookedMin = lsBookedMinutes(appts);
    const active = appts.find((a) => a.status === 'in_service');
    const rawPhoto = t.tech_avatar_url || t.gtp_avatar_url || t.user_avatar_url || null;
    return {
      technicianId: t.id, userId: t.user_id || undefined, fullName: t.full_name || t.id, initials: lsInitials(t.full_name || '?'), avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : undefined, roleLabel: t.role_label || 'Technician',
      status, shift, skills: b.skillsBy[t.id] || [], appointments: appts, openSlots, blocks,
      clock: t.id in b.clockBy ? b.clockBy[t.id] : null, shiftScheduled: !!shift && !b.punchShift.has(t.id),
      activeTicket: active ? { ticketId: active.ticketId || active.appointmentId, serviceSummary: active.serviceSummary, customerName: active.customerName } : undefined,
      bookedHours: Math.round((bookedMin / 60) * 10) / 10, utilizationPercent: lsUtilization(bookedMin, lsShiftMinutes(shift)),
    };
  }

  async state(ctx: LiveScheduleContext, f: LiveScheduleFilters): Promise<LiveTechnicianScheduleState> {
    const date = f.date || (await this.today(ctx)); const b = await this.load(ctx, date);
    let cols = b.techs.map((t) => this.column(b, t));
    if (f.status) cols = cols.filter((c) => c.status === f.status);
    if (f.skill) cols = cols.filter((c) => c.skills.includes(f.skill!));
    if (f.search) { const q = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ cols = cols.filter((c) => [c.fullName, c.roleLabel, ...c.skills].some((x) => foldVi(x).includes(q))); }
    return { date, branchId: ctx.branchId, timeRange: RANGE, technicians: cols };
  }
  async kpis(ctx: LiveScheduleContext, date: string): Promise<LiveTechnicianScheduleKpis> { const d = date || (await this.today(ctx)); const b = await this.load(ctx, d); return lsRollupKpis(b.techs.map((t) => this.column(b, t))); }
  async detail(ctx: LiveScheduleContext, technicianId: string, date: string): Promise<LiveTechnicianDetail | null> {
    const d = date || (await this.today(ctx)); const b = await this.load(ctx, d); const t = b.techs.find((x) => x.id === technicianId); if (!t) return null;
    const col = this.column(b, t);
    // Oct 13 2026 (FLOW duplicate D3 merged): the day's money comes from the compensation snapshot — the ONE payroll
    // authority (discount allocation, authored rules, posted reversals, allocated tips) — scoped to THIS location over
    // the branch's civil day. It used to re-price the lines with "price × stamped rate" (no tips, no reversals).
    let salesCents = 0, commissionCents = 0, tipsCents = 0;
    try {
      const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
      const fromMs = localDateTimeToEpochMs(d, '00:00', tz), toMs = localDateTimeToEpochMs(addDays(d, 1), '00:00', tz);
      if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
        const sums = await new CompensationSnapshotRepository(this.db).sumByTechnicianPeriod(ctx.tenantId, technicianId, new Date(fromMs).toISOString(), new Date(toMs).toISOString(), ctx.branchId);
        salesCents = Math.max(0, Math.round(sums.grossServiceCents || 0));
        tipsCents = Math.max(0, Math.round((sums.cardTipCents || 0) + (sums.cashTipCents || 0)));
        commissionCents = Math.round((sums.techServiceEarningsCents || 0) + (sums.retailCommissionCents || 0) + (sums.adjustmentsCents || 0));
      }
    } catch { salesCents = 0; commissionCents = 0; tipsCents = 0; }
    const next = col.appointments.find((a) => lsMinutesOf(a.startTime) >= b.nowMinutes && a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'completed');
    const gapQuality = await this.gapQuality(ctx, col.openSlots);
    const rawPhoto = t.tech_avatar_url || t.gtp_avatar_url || t.user_avatar_url || null;
    return {
      technicianId, userId: t.user_id || undefined, fullName: t.full_name || t.id, initials: col.initials, avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : undefined, roleLabel: t.role_label || 'Technician', phone: t.phone_display || undefined,
      status: col.status, shift: col.shift, skills: col.skills, appointments: col.appointments, openSlots: col.openSlots, blocks: col.blocks, activeTicket: col.activeTicket, nextAppointment: next,
      bookedHours: col.bookedHours, utilizationPercent: col.utilizationPercent, salesTodayCents: salesCents, tipsTodayCents: tipsCents, commissionPreviewCents: commissionCents,
      gapQuality, nextInMinutes: next && d === (await this.today(ctx)) ? Math.max(0, lsMinutesOf(next.startTime) - b.nowMinutes) : null,
    };
  }
  /** round 10 (LIVE TECHNICIAN SCHEDULE 03): what each open gap can hold — the salon's SAVED booking buffer (POS Settings →
   *  Booking & Appointments, a location row wins; the engine default 5 min otherwise) and this location's active services */
  private async gapQuality(ctx: LiveScheduleContext, slots: LiveScheduleOpenSlot[]): Promise<NonNullable<LiveTechnicianDetail['gapQuality']>> {
    if (!slots.length) return [];
    const cfg = (await sql<{ branch_id: string | null; buffer: string | null }>`SELECT branch_id, settings_json->>'bufferMinutes' AS buffer FROM tenant_settings
        WHERE tenant_id = ${ctx.tenantId} AND category = 'booking-appointments' AND (branch_id IS NULL OR branch_id::text = ${ctx.branchId ?? ''})
        ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db)).rows[0];
    const raw = cfg?.buffer == null ? NaN : Number(cfg.buffer);
    const bufferMinutes = Number.isInteger(raw) && raw >= 0 ? raw : LS_DEFAULT_BUFFER_MINUTES;
    const svcs = (await sql<{ name: string; duration_minutes: number | null }>`SELECT s.name, s.duration_minutes FROM services s
        WHERE s.tenant_id = ${ctx.tenantId} AND s.status = 'active' AND s.archived_at IS NULL AND (s.branch_id IS NULL OR s.branch_id::text = ${ctx.branchId ?? ''})`.execute(this.db)).rows
      .map((r) => ({ name: String(r.name), minutes: Math.max(0, Number(r.duration_minutes ?? 0)) })).filter((r) => r.minutes > 0);
    return slots.map((o) => {
      const usable = Math.max(0, o.durationMinutes - bufferMinutes);
      const fit = svcs.filter((x) => x.minutes <= usable).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
      return { slotId: o.slotId, startTime: o.startTime, endTime: o.endTime, minutes: o.durationMinutes, bufferMinutes, usableMinutes: usable, servicesFit: fit.length, servicesTotal: svcs.length, longestFit: fit[0] ?? null };
    });
  }
  async appointmentNotes(ctx: LiveScheduleContext, technicianId: string, date: string) {
    const rows: { id: string; start_time: string; end_time: string; customer_name: string | null; notes: string | null }[] = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx)
      .where('technician_id', '=', technicianId).where('appt_date', '=', date).where('status', 'not in', ['cancelled', 'no_show'])
      .where('notes', 'is not', null).where('notes', '<>', '')
      .select(['id', 'start_time', 'end_time', 'customer_name', 'notes']).orderBy('start_time').limit(50).execute();
    return rows.map((r) => ({ appointmentId: r.id, startTime: r.start_time, endTime: r.end_time, customerName: r.customer_name ?? null, notes: String(r.notes ?? '').trim() })).filter((r) => r.notes);
  }
  async filtersData(ctx: LiveScheduleContext) {
    const b = await this.load(ctx, (await this.today(ctx)));
    const skills = [...new Set(Object.values(b.skillsBy).flat())].sort();
    return {
      statuses: (Object.keys(LIVE_STATUS_LABEL) as LiveTechStatus[]).map((v) => ({ label: LIVE_STATUS_LABEL[v], value: v })),
      skills: skills.map((s) => ({ label: s, value: s })),
      technicians: b.techs.map((t) => ({ label: t.full_name || t.id, value: t.id })),
    };
  }
  async technicianExists(ctx: LiveScheduleContext, technicianId: string) {
    const r = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', technicianId).select('id').executeTakeFirst().catch(() => undefined); return !!r;
  }
  async hasActiveService(ctx: LiveScheduleContext, technicianId: string) {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('technician_id', '=', technicianId).where('appt_date', '=', (await this.today(ctx))).where('status', '=', 'in_service').select('id').executeTakeFirst().catch(() => undefined); return !!r;
  }

  private async writeAudit(ctx: LiveScheduleContext, actionType: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json) VALUES (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId}, ${ctx.role}, ${actionType}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb)`.execute(this.db).catch(() => undefined);
  }
  async blockTime(ctx: LiveScheduleContext, technicianId: string, req: BlockTechnicianTimeRequest) {
    const ins = await this.db.insertInto('technician_blocked_times').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: technicianId, block_date: req.date || (await this.today(ctx)), start_time: req.startTime, end_time: req.endTime, reason: req.reason || 'unavailable', note: req.note || null, created_by_user_id: ctx.userId }).returning(['id']).executeTakeFirst().catch(() => undefined);
    if (!ins) return null; const blockId = ins.id;
    await this.writeAudit(ctx, 'technician_block_time_created', 'blocked_time', blockId, { technicianId, startTime: req.startTime, endTime: req.endTime, reason: req.reason || 'unavailable' });
    return { blockId };
  }
  async setBreak(ctx: LiveScheduleContext, technicianId: string, onBreak: boolean, reason: string | undefined, byUserId: string) {
    const newStatus = onBreak ? 'on_break' : 'available';
    const cur = await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', '=', technicianId).orderBy('changed_at', 'desc').select(['status']).executeTakeFirst().catch(() => undefined);
    const oldStatus = cur?.status || 'available';
    const upd = await this.scoped(this.db.updateTable('technician_statuses'), ctx).set({ status: newStatus, changed_at: sql`now()` }).where('technician_id', '=', technicianId).executeTakeFirst().catch(() => undefined);
    if (!Number(upd?.numUpdatedRows ?? 0)) await this.db.insertInto('technician_statuses').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: technicianId, status: newStatus }).execute().catch(() => undefined);
    await sql`INSERT INTO technician_status_events (tenant_id, branch_id, technician_id, old_status, new_status, reason, changed_by_user_id) VALUES (${ctx.tenantId}, ${ctx.branchId}, ${technicianId}, ${oldStatus}, ${newStatus}, ${reason ?? null}, ${byUserId})`.execute(this.db).catch(() => undefined);
    await this.writeAudit(ctx, onBreak ? 'technician_break_started' : 'technician_break_ended', 'technician', technicianId, { reason });
    return true;
  }
  async bookOpenSlot(ctx: LiveScheduleContext, slotId: string, body: { customerName?: string; durationMinutes?: number; customerId?: string; serviceSummary?: string }) {
    const idx = slotId.lastIndexOf(':'); if (idx < 0) return null;
    const technicianId = slotId.slice(0, idx); const start = Number(slotId.slice(idx + 1)); if (!technicianId || Number.isNaN(start)) return null;
    const dur = body.durationMinutes || RANGE.slotMinutes;
    const services = body.serviceSummary ? [{ serviceName: body.serviceSummary }] : [];
    const apptDate = await this.today(ctx);
    // Merge Oct 12 2026: through the shared appointment-slot-guard (technician+day lock, in-txn re-check, 23P01 → conflict) —
    // a lost race throws AppointmentSlotConflict (→ 409 at the service) instead of being swallowed into "could not book".
    const ins = await writeAppointmentSlot(this.db, {
      tenantId: ctx.tenantId, technicianId, date: apptDate, startTime: lsToHHMM(start), endTime: lsToHHMM(start + dur),
      // Oct 21 2026: THE one appointment writer — the row and its appointment.created commit together (this path wrote no event)
      write: async (trx) => ({ id: await this.writer.insert(trx, { tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId, customerId: body.customerId || null, customerName: body.customerName || 'Walk In', isVip: false, source: 'manual', services, date: apptDate, startTime: lsToHHMM(start), endTime: lsToHHMM(start + dur), durationMinutes: dur, status: 'booked', depositStatus: 'not_required' }, { userId: ctx.userId ?? null, actorType: 'user' }) }),
    });
    if (!ins) return null; const appointmentId = ins.id;
    await this.writeAudit(ctx, 'technician_open_slot_booked', 'appointment', appointmentId, { slotId, technicianId });
    return { appointmentId };
  }
}
