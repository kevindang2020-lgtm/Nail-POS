// booking.kysely.repository.ts — production BookingRepositoryPort over Postgres (Kysely). POS Booking shares the
// pos_tech_appointments table with tech-appointments, so all appointment CRUD, reschedule/assign/status, the services
// JSONB array and the three idempotency keys (queue / tech-queue / serving) are REAL persisted columns. Technicians +
// their skill categories are real (technicians + technician_services → services → service_categories); the service
// catalog is real (services + service_categories). Scope is session-derived (tenant + branch-or-null).
//
// Honest fallbacks: settings/integration use the documented defaults (no per-tenant booking-settings table here);
// depositsCollectedCents is 0 (pos_tech_appointments tracks deposit_status, not a deposit amount in cents); today() is
// the server's current date.
import { AppointmentWriter } from '@aipowersalon/appointments';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { recordAppointmentChanges } from '@aipowersalon/appointments';
import type { BookingRepositoryPort, BookingContext, BookingQueryOpts, RosterRec, BkItem, TechRec, SvcRec, BookingCreateOpts, RescheduleOptions, UpdateOptions, HoldGuard } from './booking.repository';
import { lockedForeignHold } from '../customer-booking/booking-hold-locked-check';
import { effectiveDaySchedule, addLocalDays, type ShiftOverride } from './shift-overrides';
import { weeklyOffTechs } from './weekly-off';
import { pbTimeOffToBlock,
  POSBookingFullState, POSBookingAppointmentRow, POSBookingKpisFull, BookingFilters, PBStatus, PBSource, PBDepositStatus,
  BookingSettings, DEFAULT_BOOKING_SETTINGS, BookingIntegrationStatus, DEFAULT_INTEGRATION_STATUS,
  pbAddMinutes, pbDuration, pbDetectTechnicianConflict, pbComputeAvailability, pbArrivingSoon, BookingConflictRace, BookingSlotHeld, BookingVersionConflict, computeBookingAggregates, pbLateness, pbWithLateness,
  type PBTechDaySchedule,
} from './booking.dto';
import { clampPageSize, clampPage, APPOINTMENT_DISPLAY_STATUSES, isAwaitingArrival, foldVi } from '@aipowersalon/api-contracts';
import { businessDate, zonedParts, localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { branchTimeZone, assertTransition, canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { buildMediaUrl } from '@aipowersalon/media';

const parseServices = (v: any): any[] => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
type ExRow = { appointmentId: string; technicianId?: string; customerId?: string; startTime: string; endTime: string; status: PBStatus };

export class KyselyBookingRepository implements BookingRepositoryPort {
  /** the filter facet's branch list: the session branch's own name from branches (no sample data); [] when unknown */
  private async sessionBranchFacet(ctx: { tenantId: string; branchId?: string | null }): Promise<{ branchId: string; name: string }[]> {
    if (!ctx.branchId) return [];
    const b = await (this.db as any).selectFrom('branches').select(['id', 'name']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ctx.branchId).executeTakeFirst();
    return b ? [{ branchId: String(b.id), name: String(b.name) }] : [];
  }
  private seq = Date.now() % 1000000;
  // Constitution 8 §18: domain events are written INSIDE the same transaction as the business rows. Optional so
  // existing construction sites and tests are unaffected; when absent, no event is written (never a fake one).
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  nextSeq() { return ++this.seq; }
  // Decision 38 / Oct 1 2026: the salon's day and minute, not UTC's. toISOString().slice(0, 10) is the UTC day — after
  // 8 pm in New Jersey the board defaulted to TOMORROW and today's past slots stopped being clamped, on a board that runs
  // to 9 pm. Zone = the booking settings' timezone (America/New_York; per-branch time zones are not wired yet).
  today() { return businessDate(this._settings().timezone); }
  nowMinuteOfDay() { const p = zonedParts(new Date(), this._settings().timezone); return p.hour * 60 + p.minute; }
  /** The branch's own clock: branches.timezone (shared lookup, cached) → America/New_York. */
  async clock(ctx: BookingContext) {
    const timeZone = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
    const p = zonedParts(new Date(), timeZone);
    return { today: businessDate(timeZone), nowMinute: p.hour * 60 + p.minute, timeZone };
  }

  private scoped(qb: any, ctx: BookingContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private _settings(): BookingSettings { return DEFAULT_BOOKING_SETTINGS; }
  /** The salon's SAVED Booking & Appointments settings (POS Settings → tenant_settings, category 'booking-appointments';
   *  a branch row wins over the tenant-wide one), overlaid on the engine defaults. Until Sep 30 2026 this returned the
   *  hard-coded defaults for every salon, so nothing saved on that screen reached the booking engine. Only the fields
   *  the engine enforces are mapped (slot interval, buffer, default duration, deposit required, overbooking policy);
   *  lead time / advance window / cancellation / no-show are not enforced on staff bookings and stay as they were. */
  async settings(ctx: BookingContext): Promise<BookingSettings> {
    const base = this._settings();
    const rows: any[] = await this.db.selectFrom('tenant_settings').select(['branch_id', 'settings_json'])
      .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'booking-appointments')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || '00000000-0000-0000-0000-000000000000'), eb('branch_id', 'is', null)]))
      .execute().catch(() => []);
    const row = rows.find((r) => r.branch_id) ?? rows[0];
    if (!row?.settings_json) return base;
    let v: any; try { v = typeof row.settings_json === 'string' ? JSON.parse(row.settings_json) : row.settings_json; } catch { return base; }
    const posInt = (x: unknown, fallback: number) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : fallback);
    const policy = ['BLOCK', 'WARN_REQUIRE_CONFIRMATION', 'ALLOW_AUTHORIZED_ROLE'].includes(v.overbookingPolicy) ? v.overbookingPolicy : base.overbookingPolicy;
    return {
      ...base,
      slotIntervalMinutes: posInt(v.slotIntervalMinutes, base.slotIntervalMinutes) || base.slotIntervalMinutes,
      bufferMinutes: posInt(v.bufferMinutes, base.bufferMinutes),
      defaultServiceDurationMinutes: posInt(v.defaultDurationMinutes, base.defaultServiceDurationMinutes) || base.defaultServiceDurationMinutes,
      depositRequired: typeof v.depositRequired === 'boolean' ? v.depositRequired : base.depositRequired,
      overbookingPolicy: policy,
      lateGraceMinutes: Number.isInteger(v.lateGraceMinutes) && v.lateGraceMinutes >= 0 && v.lateGraceMinutes <= 120 ? v.lateGraceMinutes : base.lateGraceMinutes,   // Decision 32/38
    };
  }
  async integrationStatus(_ctx: BookingContext): Promise<BookingIntegrationStatus> { return DEFAULT_INTEGRATION_STATUS; }

  private async _catalog(ctx: BookingContext): Promise<SvcRec[]> {
    const rows = await this.scoped(this.db.selectFrom('services as s'), ctx, 's').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('s.status', '=', 'active').select(['s.id as serviceId', 's.name as name', 'c.name as categoryName', 's.duration_minutes as dur', 's.price_cents as price']).execute().catch(() => []);
    return rows.map((r: any) => ({ serviceId: r.serviceId, name: r.name, categoryName: r.categoryName || 'General', durationMinutes: Number(r.dur || 0), priceCents: Number(r.price || 0) }));
  }
  async serviceCatalog(ctx: BookingContext) { return this._catalog(ctx); }

  /** Technicians of the scope (not archived) in ROSTER ORDER (name, then id — the board's "#n"); with `ids`, only those.
   *  200-technician mandate §26/§27 (Oct 23 2026): skills are one batch read for the requested technicians and ratings are
   *  aggregated IN SQL (it read every review row of every technician on every call); no payroll / private column is read. */
  private async _technicians(ctx: BookingContext, ids?: string[]): Promise<TechRec[]> {
    if (ids && !ids.length) return [];
    let tq = this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech')
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .where('tech.status', '!=', 'archived');
    if (ids) tq = tq.where('tech.id', 'in', ids);
    const techs = await tq
      .select(['tech.id', 'tech.full_name', 'tech.is_active', 'tech.status', 'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'])
      .orderBy('tech.full_name').orderBy('tech.id')
      .execute().catch(() => []);
    // a technician linked to two profiles (by id and by user) came back twice from the OR join — keep the first row
    const seen = new Set<string>(); const uniq = techs.filter((t: { id: string }) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    const idsArr = uniq.map((t: any) => t.id);
    const links = idsArr.length ? await this.scoped(this.db.selectFrom('technician_services as ts'), ctx, 'ts').innerJoin('services as s', 's.id', 'ts.service_id').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('ts.technician_id', 'in', idsArr).select(['ts.technician_id as tid', 'c.name as cat']).distinct().execute().catch(() => []) : [];
    const skillBy: Record<string, Set<string>> = {}; for (const l of links) { (skillBy[l.tid] ||= new Set()).add(l.cat || 'General'); }
    // Per-technician rating from the shared reviews table (technician-attributed since 066), aggregated by the database.
    const ratingBy: Record<string, { avg: number; count: number }> = {};
    if (idsArr.length) {
      const revs = await this.scoped(this.db.selectFrom('reviews'), ctx).where('technician_id', 'in', idsArr).where('rating', 'is not', null)
        .select(['technician_id as tid', sql<string>`avg(rating)`.as('avg'), sql<string>`count(*)`.as('n')]).groupBy('technician_id').execute().catch(() => []);
      for (const r of revs) { const a = Number(r.avg), n = Number(r.n); if (Number.isFinite(a) && n > 0) ratingBy[r.tid] = { avg: a, count: n }; }
    }
    return uniq.map((t: any) => {
      const agg = ratingBy[t.id];
      const photo = t.tech_avatar_url || t.gtp_avatar_url || t.user_avatar_url;
      return { technicianId: t.id, name: t.full_name || t.id, available: !!t.is_active, skills: [...(skillBy[t.id] || [])], avatarUrl: photo ? buildMediaUrl(photo) : null,
        rating: agg ? Math.round(agg.avg * 10) / 10 : null, reviewCount: agg ? agg.count : 0 };
    });
  }
  async technicians(ctx: BookingContext, ids?: string[]) { return this._technicians(ctx, ids); }
  async technicianBranches(ctx: BookingContext, technicianIds: string[]) {
    const out = new Map<string, { branchId: string | null; name: string | null }>();
    if (!technicianIds.length) return out;
    const rows = (await sql<{ id: string; branch_id: string | null; name: string | null }>`select tech.id, tech.branch_id, br.name from technicians tech
      left join branches br on br.id = tech.branch_id and br.tenant_id = tech.tenant_id
      where tech.tenant_id = ${ctx.tenantId} and tech.id = any(${technicianIds}::uuid[])`.execute(this.db)).rows;
    for (const r of rows) out.set(String(r.id), { branchId: r.branch_id ? String(r.branch_id) : null, name: r.name ?? null });
    return out;
  }
  /** booking200 §08 (round 12): live Customer Queue counts for the KPI strip (see the port). One aggregate read, branch
   *  scoped like every queue read; the walk-in day is the BRANCH's day (checked_in_at at time zone). A failed read throws. */
  async queueCounts(ctx: BookingContext, date: string): Promise<{ waitingNow: number; walkInVisits: number }> {
    const clk = await this.clock(ctx);
    const branch = ctx.branchId ? sql`and q.branch_id = ${ctx.branchId}::uuid` : sql``;
    // the branch day as an instant range [local midnight, next local midnight) — index-friendly on checked_in_at
    const dayStart = sql`(${date}::date::timestamp at time zone ${clk.timeZone})`;
    const dayEnd = sql`((${date}::date + 1)::timestamp at time zone ${clk.timeZone})`;
    const r = (await sql<{ waiting: number | string | null; walkins: number | string | null }>`select
        count(*) filter (where q.status = 'waiting') as waiting,
        count(*) filter (where q.appointment_id is null and q.source <> 'appointment' and q.status not in ('cancelled', 'removed')
          and q.checked_in_at >= ${dayStart} and q.checked_in_at < ${dayEnd}) as walkins
      from pos_queue_items q where q.tenant_id = ${ctx.tenantId}::uuid ${branch}
        and (q.status = 'waiting' or (q.checked_in_at >= ${dayStart} and q.checked_in_at < ${dayEnd}))`.execute(this.db)).rows[0];
    return { waitingNow: Number(r?.waiting ?? 0), walkInVisits: Number(r?.walkins ?? 0) };
  }
  /** 200-technician mandate §8: the whole branch's roster in ONE light read (no skills, ratings, avatars) — the server pages,
   *  searches and filters this; only the visible page then reads its detail. */
  async technicianRoster(ctx: BookingContext): Promise<RosterRec[]> {
    const rows = await this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech').where('tech.status', '!=', 'archived')
      .select(['tech.id', 'tech.full_name', 'tech.is_active', 'tech.normalized_phone', 'tech.email'])
      .orderBy('tech.full_name').orderBy('tech.id').execute();   // a failed roster read is an error, never "no technicians"
    return rows.map((t: { id: unknown; full_name: string | null; is_active: boolean | null; normalized_phone: string | null; email: string | null }) => ({ technicianId: String(t.id), name: t.full_name || String(t.id), available: !!t.is_active,
      searchText: [t.full_name, t.normalized_phone, t.email].filter(Boolean).join(' ').toLowerCase() }));
  }

  /** F4 (Oct 30 2026): the date-specific overrides for `date` and the day before (an overnight shift's early-morning
   *  part), branch-scoped. A failed read is an error, never "no override" (which would silently restore the template). */
  async shiftOverrides(ctx: BookingContext, dates: string[]): Promise<Map<string, ShiftOverride>> {
    const out = new Map<string, ShiftOverride>();
    if (!dates.length || !ctx.branchId) return out;
    const rows = (await sql<any>`select o.technician_id, to_char(o.local_shift_date, 'YYYY-MM-DD') as d, o.override_type, to_char(o.start_local_time, 'HH24:MI') as s, to_char(o.end_local_time, 'HH24:MI') as e,
        o.ends_next_day, o.breaks_json, o.version from technician_shift_overrides o
      where o.tenant_id = ${ctx.tenantId} and o.branch_id = ${ctx.branchId} and o.local_shift_date = any(${dates}::date[])`.execute(this.db)).rows;
    for (const r of rows) out.set(`${r.technician_id}|${r.d}`, { technicianId: String(r.technician_id), localDate: String(r.d), overrideType: r.override_type, startLocalTime: r.s ?? null, endLocalTime: r.e ?? null,
      endsNextDay: !!r.ends_next_day, breaks: Array.isArray(r.breaks_json) ? r.breaks_json : [], version: Number(r.version) });
    return out;
  }

  async techSchedules(ctx: BookingContext, dayOfWeek: number, date?: string): Promise<Record<string, PBTechDaySchedule>> {
    const recurring = await this.recurringSchedules(ctx, dayOfWeek);
    if (!date) return recurring;
    // G3 (Nov 5 2026): a manager's repeating weekly day off beats the weekly template (a date override still beats both)
    const off = await weeklyOffTechs(this.db, ctx.tenantId, ctx.branchId ?? null, date);
    const base: Record<string, PBTechDaySchedule> = { ...recurring };
    for (const t of off) base[t] = { isWorking: false, startTime: null, endTime: null, lunchStartTime: null, lunchEndTime: null, shifts: null, breaks: null };
    const prev = addLocalDays(date, -1); const ov = await this.shiftOverrides(ctx, [date, prev]);
    if (!ov.size) return base;
    const out: Record<string, PBTechDaySchedule> = { ...base };
    const techs = new Set<string>([...Object.keys(base), ...[...ov.values()].map((o) => o.technicianId)]);
    for (const t of techs) {
      const eff = effectiveDaySchedule(base[t], ov.get(`${t}|${date}`) ?? null, ov.get(`${t}|${prev}`) ?? null);
      if (eff) out[t] = eff; else delete out[t];
    }
    return out;
  }
  private async recurringSchedules(ctx: BookingContext, dayOfWeek: number): Promise<Record<string, PBTechDaySchedule>> {
    const rows = await this.scoped(this.db.selectFrom('technician_schedules'), ctx)
      .where('day_of_week', '=', dayOfWeek)
      .select(['technician_id', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working', 'shifts', 'breaks'])
      .execute();   // mandate §51 P3 (Oct 20 2026): a failed schedule read is an error, never "no schedule" (which read as bookable all day)
    const out: Record<string, PBTechDaySchedule> = {};
    for (const r of rows) {
      let shifts = null;
      let breaks = null;
      try { if (r.shifts) shifts = typeof r.shifts === 'string' ? JSON.parse(r.shifts) : r.shifts; } catch {}
      try { if (r.breaks) breaks = typeof r.breaks === 'string' ? JSON.parse(r.breaks) : r.breaks; } catch {}
      out[r.technician_id] = { isWorking: !!r.is_working, startTime: r.start_time, endTime: r.end_time, lunchStartTime: r.lunch_start_time, lunchEndTime: r.lunch_end_time, shifts, breaks };
    }
    return out;
  }
  async blockedTimes(ctx: BookingContext, date: string): Promise<Record<string, { blockId?: string; startTime: string; endTime: string; reason: string }[]>> {
    const rows = await this.scoped(this.db.selectFrom('technician_blocked_times'), ctx)
      .where('block_date', '=', date)
      .select(['id', 'technician_id', 'start_time', 'end_time', 'reason'])
      .execute();   // same: a failed blocked-time read must not look like a free day
    const out: Record<string, { blockId?: string; startTime: string; endTime: string; reason: string }[]> = {};
    for (const r of rows) (out[r.technician_id] ||= []).push({ blockId: r.id, startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5), reason: r.reason || 'blocked' });
    // Mandate §51 (Oct 20 2026): APPROVED time off is part of the technician's day like a blocked time. This is the ONE
    // schedule reader (staff booking, customer app, AI receptionist and availability all read through it — see
    // customer-booking.kysely.repository techWindows), so every path stops booking a technician on her approved day off.
    // Approving time off writes no blocked-time row; it is read here instead, so cancelling the time off frees the day at once.
    {
      const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
      const dayStart = localDateTimeToEpochMs(date, '00:00', tz), dayEnd = dayStart + 24 * 60 * 60_000;
      const offs = await this.scoped(this.db.selectFrom('technician_time_off'), ctx)
        .where('status', '=', 'approved').where('starts_at', '<', new Date(dayEnd)).where('ends_at', '>', new Date(dayStart))
        .select(['id', 'technician_id', 'starts_at', 'ends_at', 'reason', 'kind']).execute();
      for (const o of offs) {
        const b = pbTimeOffToBlock({ startsAtMs: new Date(o.starts_at).getTime(), endsAtMs: new Date(o.ends_at).getTime(), reason: o.kind ? String(o.kind).toLowerCase() : o.reason }, dayStart, dayEnd, tz);
        if (b) (out[o.technician_id] ||= []).push({ blockId: 'time-off:' + o.id, ...b });
      }
    }
    return out;
  }
  async addBlockedTime(ctx: BookingContext, input: { technicianId: string; date: string; startTime: string; endTime: string; reason: string; note?: string }): Promise<{ blockId: string }> {
    const row: any = await this.db.insertInto('technician_blocked_times').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: input.technicianId,
      block_date: input.date, start_time: input.startTime, end_time: input.endTime,
      reason: input.reason, note: input.note ?? null, created_by_user_id: ctx.userId || null,
    }).returning('id').executeTakeFirst();
    return { blockId: String(row?.id) };
  }
  async removeBlockedTime(ctx: BookingContext, blockId: string): Promise<boolean> {
    const res = await this.scoped(this.db.deleteFrom('technician_blocked_times'), ctx)
      .where('id', '=', blockId)
      .executeTakeFirst().catch(() => null);
    return Number(res?.numDeletedRows ?? 0) > 0;
  }

  private cols = ['id', 'technician_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'services', 'appt_date', 'start_time', 'end_time', 'duration_minutes', 'status', 'deposit_status', 'notes', 'queue_idempotency_key', 'tech_queue_idempotency_key', 'serving_idempotency_key', 'arrived_at', 'overbook_ok', 'version'] as const;   // + version (merge Nov 13 2026): every read answered version 1 — a row edited once could never be moved with its expectedVersion

  /** pg returns DATE columns as JS Date objects; the domain uses plain 'YYYY-MM-DD' strings everywhere. */
  private isoDate(v: unknown): string { return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10); }

  private rowToBkItem(r: any): BkItem {
    return {
      appointmentId: r.id, technicianId: r.technician_id || null, customerId: r.customer_id || undefined, customerName: r.customer_name || '', customerPhone: r.customer_phone || undefined, isVip: !!r.is_vip,
      services: parseServices(r.services), source: r.source as PBSource, date: this.isoDate(r.appt_date), startTime: r.start_time, endTime: r.end_time, status: r.status as PBStatus, depositStatus: r.deposit_status as PBDepositStatus,
      depositCents: 0, notes: r.notes || '', queueKey: r.queue_idempotency_key || undefined, techQueueKey: r.tech_queue_idempotency_key || undefined, servingKey: r.serving_idempotency_key || undefined, createdAt: '', updatedAt: '',
      arrivedAt: r.arrived_at ? new Date(r.arrived_at).toISOString() : null,
    };
  }
  private rowToRow(ctx: BookingContext, r: any, existing: ExRow[], techs: TechRec[], techTicketStatus?: string, customerAvatarUrl?: string | null, bufferMinutes?: number, lateGraceMinutes?: number, clk?: { today: string; nowMinute: number }): POSBookingAppointmentRow {
    const services = parseServices(r.services);
    const conf = r.technician_id ? pbDetectTechnicianConflict(existing, r.technician_id, r.start_time, r.end_time, bufferMinutes ?? this._settings().bufferMinutes, r.id) : { status: 'none' as const };
    const tech = techs.find((t) => t.technicianId === r.technician_id);
    const avatar = customerAvatarUrl || r.customer_avatar_url;
    const row: POSBookingAppointmentRow = {
      appointmentId: r.id, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: r.customer_id || undefined, customerName: r.customer_name || '', customerPhone: r.customer_phone || undefined, isVip: !!r.is_vip,
      customerAvatarUrl: avatar ? buildMediaUrl(avatar) : null,
      technicianId: r.technician_id || undefined, technicianName: tech ? tech.name : undefined, services, source: r.source as PBSource, startTime: r.start_time, endTime: r.end_time, durationMinutes: Number(r.duration_minutes || pbDuration(services)),
      version: Number(r.version ?? 1), ...(r.overbook_ok ? { overbooked: true } : {}),
      status: r.status as PBStatus, depositStatus: r.deposit_status as PBDepositStatus, conflictStatus: conf.status, queueKey: r.queue_idempotency_key || undefined, techTicketStatus: techTicketStatus || undefined, startSource: r.start_source || undefined, notes: r.notes || '', createdAt: '', updatedAt: '',
      date: r.appt_date ? this.isoDate(r.appt_date) : undefined, arrivedAt: r.arrived_at ? new Date(r.arrived_at).toISOString() : null,
    };
    // Decision 38: LATE from the salon clock, on every read (never stored).
    const c = clk ?? { today: this.today(), nowMinute: this.nowMinuteOfDay() };
    return pbWithLateness(row, c.today, c.nowMinute, lateGraceMinutes ?? this._settings().lateGraceMinutes);
  }

  async booking(ctx: BookingContext, id: string): Promise<BkItem | null> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.cols).executeTakeFirst().catch(() => undefined);
    return r ? this.rowToBkItem(r) : null;
  }
  async changedSince(ctx: BookingContext, since: Date, limit: number, opts?: { after?: { ms: number; id: string }; upto?: Date }): Promise<{ id: string; updatedAt: string }[]> {
    // Served by idx_pos_tech_appointments_tenant_branch_updated (482). updated_at is stamped on every UPDATE by the
    // 483 trigger, whichever module writes the row. M4 paging: rows are ordered and keyed by (the stamp in whole
    // MILLISECONDS — what the cursor can carry — , id as text), so a continuation resumes exactly after the last row sent.
    const msKey = sql<string>`floor(extract(epoch from updated_at) * 1000)::bigint`;
    let q = this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('updated_at', '>=', since);
    if (opts?.upto) q = q.where('updated_at', '<=', opts.upto);
    if (opts?.after) q = q.where(sql<boolean>`(${msKey}, id::text) > (${String(Math.trunc(opts.after.ms))}::bigint, ${opts.after.id})`);
    const rows = await q.select(['id', msKey.as('ms')]).orderBy(msKey, 'asc').orderBy(sql`id::text`, 'asc').limit(limit).execute();
    return rows.map((r: any) => ({ id: String(r.id), updatedAt: new Date(Number(r.ms)).toISOString() }));
  }
  async detail(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow | null> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.cols).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    const tq: any = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('appointment_id', '=', id).select('status').executeTakeFirst().catch(() => undefined);
    const existing = await this.existingForConflict(ctx, this.isoDate(r.appt_date)); const techs = await this._technicians(ctx);
    let custAvatar: string | null = null;
    if (r.customer_id) {
      const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', r.customer_id).select(['avatar_url']).executeTakeFirst().catch(() => undefined);
      if (c?.avatar_url) custAvatar = c.avatar_url;
    }
    const st = await this.settings(ctx);
    return this.rowToRow(ctx, r, existing, techs, tq?.status, custAvatar, st.bufferMinutes, st.lateGraceMinutes, await this.clock(ctx));
  }
  /** 200-technician mandate §26 (Oct 23 2026): the change feed's rows in ONE pass — it ran detail() (≈8 queries, the whole
   *  roster and the whole day each time) per changed row. Same mapping as detail(); ids outside the scope are skipped. */
  async detailsMany(ctx: BookingContext, ids: string[]): Promise<POSBookingAppointmentRow[]> {
    const want = [...new Set(ids.filter(Boolean))];
    if (!want.length) return [];
    const rows: any[] = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', 'in', want).select(this.cols).execute();
    if (!rows.length) return [];
    const [st, clk] = await Promise.all([this.settings(ctx), this.clock(ctx)]);
    const dates = [...new Set(rows.map((r) => this.isoDate(r.appt_date)))];
    const existingByDate = new Map<string, ExRow[]>();
    for (const d of dates) existingByDate.set(d, await this.existingForConflict(ctx, d));
    const techs = await this._technicians(ctx, [...new Set(rows.map((r) => r.technician_id).filter(Boolean))] as string[]);
    const tq: any[] = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('appointment_id', 'in', rows.map((r) => r.id)).select(['appointment_id', 'status']).execute();
    const tqMap = new Map<string, string>(tq.filter((x) => x.appointment_id).map((x) => [x.appointment_id, x.status]));
    const custIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))] as string[];
    const custs: any[] = custIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'avatar_url']).execute() : [];
    const av = new Map<string, string | null>(custs.map((c) => [c.id, c.avatar_url ?? null]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return want.filter((id) => byId.has(id)).map((id) => { const r = byId.get(id); return this.rowToRow(ctx, r, existingByDate.get(this.isoDate(r.appt_date)) || [], techs, tqMap.get(r.id), r.customer_id ? av.get(r.customer_id) ?? null : null, st.bufferMinutes, st.lateGraceMinutes, clk); });
  }
  async existingForConflict(ctx: BookingContext, date: string): Promise<ExRow[]> {
    // check:silent-catch (Oct 21 2026): a guard read fails CLOSED — a database error here is the caller's error, never
    // "no appointments today" (which let a double-booking past every buffer rule).
    const rows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date).select(['id', 'technician_id', 'customer_id', 'start_time', 'end_time', 'status']).execute();
    return rows.map((a: any) => ({ appointmentId: a.id, technicianId: a.technician_id || undefined, customerId: a.customer_id || undefined, startTime: a.start_time, endTime: a.end_time, status: a.status as PBStatus }));
  }

  async availability(ctx: BookingContext, date: string, durationMinutes: number, technicianId?: string) {
    const s = await this.settings(ctx); const techs = (await this._technicians(ctx)).filter((t) => !technicianId || t.technicianId === technicianId);
    const dayRows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date).select(['technician_id', 'start_time', 'end_time', 'status']).execute().catch(() => []);
    const dur = durationMinutes > 0 ? durationMinutes : s.defaultServiceDurationMinutes;
    return techs.map((t) => {
      const mine = dayRows.filter((a: any) => a.technician_id === t.technicianId).map((a: any) => ({ startTime: a.start_time, endTime: a.end_time, status: a.status as PBStatus }));
      return { technicianId: t.technicianId, name: t.name, slots: t.available ? pbComputeAvailability(s.openTime, s.closeTime, s.slotIntervalMinutes, dur, s.bufferMinutes, mine) : [] };
    });
  }

  async query(ctx: BookingContext, f: BookingFilters, opts?: BookingQueryOpts): Promise<POSBookingFullState> {
    const clk = await this.clock(ctx);
    const date = f.date || clk.today;
    let qb = this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx);
    qb = (f.from && f.to) ? qb.where('appt_date', '>=', f.from).where('appt_date', '<=', f.to) : qb.where('appt_date', '=', date);
    // 200-technician mandate §18/§52: the day grid asks for the VISIBLE technicians' rows (+ the unassigned column) only.
    const onlyTechs = opts?.technicianIds ? [...new Set(opts.technicianIds)] : null;
    if (onlyTechs) qb = qb.where((eb: any) => { const ors: any[] = []; if (onlyTechs.length) ors.push(eb('technician_id', 'in', onlyTechs)); if (opts?.includeUnassigned !== false) ors.push(eb('technician_id', 'is', null)); return ors.length ? eb.or(ors) : sql<boolean>`false`; });
    // check:silent-catch (Oct 23 2026): the board's read fails loudly — an error used to draw an EMPTY day ("no bookings")
    const dayRows = await qb.select(this.cols).orderBy('appt_date').orderBy('start_time').orderBy('id').execute();
    const existingByDate = new Map<string, ExRow[]>();
    for (const d of [...new Set(dayRows.map((a: any) => this.isoDate(a.appt_date)))] as string[]) existingByDate.set(d, await this.existingForConflict(ctx, d));
    const cat = await this._catalog(ctx); const st = await this.settings(ctx); const buf = st.bufferMinutes;
    // the technician names on the rows: only the technicians those rows name (not the whole roster) — the filter list below
    // still lists every technician by id + name (one light roster read)
    const rowTechIds = [...new Set(dayRows.map((a: any) => a.technician_id).filter(Boolean))] as string[];
    const techs = await this._technicians(ctx, rowTechIds);
    // 200-technician §2: a caller that asked for no roster (?roster=none — every POS screen now) does not pay for reading it
    const roster = f.roster === 'none' ? [] : await this.technicianRoster(ctx);
    const today = clk.today, nowMin = clk.nowMinute;
    const lateOf = (a: any) => pbLateness(this.isoDate(a.appt_date), a.start_time, a.status as PBStatus, today, nowMin, st.lateGraceMinutes).lateness;
    const confOf = (a: any) => a.technician_id ? pbDetectTechnicianConflict(existingByDate.get(this.isoDate(a.appt_date)) || [], a.technician_id, a.start_time, a.end_time, buf, a.id).status : 'none';

    let rows = dayRows.slice();
    if (f.search) { const q = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ rows = rows.filter((a: any) => [a.customer_name, a.customer_phone, a.notes, ...parseServices(a.services).map((x: any) => x.serviceName)].some((x) => foldVi(x).includes(q))); }
    if (f.technicianId) rows = rows.filter((a: any) => a.technician_id === f.technicianId);
    if (f.status) rows = rows.filter((a: any) => f.status === 'late' ? !!lateOf(a) : a.status === f.status);   // 'late' is computed (Decision 38)
    if (f.source) rows = rows.filter((a: any) => a.source === f.source);
    if (f.serviceCategory) rows = rows.filter((a: any) => parseServices(a.services).some((rs: any) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory));
    if (f.depositStatus) rows = rows.filter((a: any) => a.deposit_status === f.depositStatus);
    if (f.conflictOnly) rows = rows.filter((a: any) => confOf(a) !== 'none');

    const conflictCount = dayRows.filter((a: any) => confOf(a) !== 'none').length;
    const kpis: POSBookingKpisFull = {
      totalBookingsToday: dayRows.length,
      confirmedBookings: dayRows.filter((a: any) => isAwaitingArrival(a.status)).length,
      arrivedBookings: dayRows.filter((a: any) => a.status === 'arrived').length,   // Decision 38
      lateBookings: dayRows.filter((a: any) => !!lateOf(a)).length,                 // Decision 38 (computed)
      arrivingSoonBookings: pbArrivingSoon(dayRows.map((a: any) => ({ date: this.isoDate(a.appt_date), startTime: String(a.start_time), status: String(a.status) })), today, nowMin, opts?.arrivingSoonWindowMinutes),
      awaitingConfirmationBookings: dayRows.filter((a: any) => a.status === 'booked').length,
      checkedInBookings: dayRows.filter((a: any) => a.status === 'checked_in').length,
      waitingBookings: dayRows.filter((a: any) => a.status === 'waiting').length,
      inServiceBookings: dayRows.filter((a: any) => a.status === 'in_service').length,
      completedBookings: dayRows.filter((a: any) => a.status === 'completed').length,
      cancelledBookings: dayRows.filter((a: any) => a.status === 'cancelled').length,
      noShowBookings: dayRows.filter((a: any) => a.status === 'no_show').length,
      onlineBookings: dayRows.filter((a: any) => a.source === 'online' || a.source === 'customer_app').length,
      googleBookings: dayRows.filter((a: any) => a.source === 'google').length,
      aiBookings: dayRows.filter((a: any) => a.source === 'ai').length,
      conflictCount,
      depositsCollectedCents: 0,
    };
    // the day grid (unbounded) gets the whole day for its columns; every other caller gets one bounded page
    const page = opts?.unbounded ? 1 : clampPage(f.page), pageSize = opts?.unbounded ? Math.max(1, rows.length) : clampPageSize(f.pageSize, 50);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    // 200-technician mandate §26: the tech-queue status of THIS page's appointments only (it read every ticket the tenant
    // ever had, all time, on every board load)
    const pageIds = pageRows.map((a: any) => a.id);
    const tqRows: any[] = pageIds.length ? await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('appointment_id', 'in', pageIds).select(['appointment_id', 'status']).execute() : [];
    const tqMap = new Map<string, string>();
    for (const tq of tqRows) if (tq.appointment_id) tqMap.set(tq.appointment_id, tq.status);

    const customerIds = [...new Set(pageRows.map((a: any) => a.customer_id).filter(Boolean))];
    const custRows = customerIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', customerIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const custAvatarMap: Record<string, string | null> = {};
    for (const c of custRows) {
      if (c.id && c.avatar_url) custAvatarMap[c.id] = c.avatar_url;
    }
    const pageRowItems = pageRows.map((a: any) => this.rowToRow(ctx, a, existingByDate.get(this.isoDate(a.appt_date)) || [], techs, tqMap.get(a.id), a.customer_id ? custAvatarMap[a.customer_id] : null, buf, st.lateGraceMinutes, clk));
    return {
      kpis, dateRange: { from: f.from || date, to: f.to || date, timezone: clk.timeZone },
      bookings: { items: pageRowItems, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: [...APPOINTMENT_DISPLAY_STATUSES],   // Decision 38: incl. arrived and the computed late
        sources: ['walk_in', 'phone', 'online', 'google', 'ai', 'customer_app', 'manual'],
        technicians: roster.map((t) => ({ technicianId: t.technicianId, name: t.name })),
        services: cat.map((s) => ({ serviceId: s.serviceId, name: s.name, priceCents: s.priceCents, durationMinutes: s.durationMinutes })),
        serviceCategories: [...new Set(cat.map((s) => s.categoryName))],
        branches: await this.sessionBranchFacet(ctx),   // the session's real branch (was a hard-coded sample name)
      },
      settings: this._settings(),
      integrationStatus: DEFAULT_INTEGRATION_STATUS,
      aggregates: computeBookingAggregates(dayRows.map((a: any) => ({ source: a.source, status: a.status, services: parseServices(a.services) }))),
    };
  }

  async create(ctx: BookingContext, item: BkItem, opts?: BookingCreateOpts): Promise<POSBookingAppointmentRow> {
    // Oct 21 2026: THE one appointment writer (modules/appointments) — the row and its appointment.created commit together.
    const writer = new AppointmentWriter(this.outbox);
    const insertOn = (trx: Kysely<DB>) => writer.insert(trx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: item.technicianId, customerId: item.customerId || null, customerName: item.customerName, customerPhone: item.customerPhone || null, isVip: item.isVip,
      source: item.source, services: item.services, date: item.date, startTime: item.startTime, endTime: item.endTime, durationMinutes: pbDuration(item.services), status: item.status, depositStatus: item.depositStatus, notes: item.notes || null,
      anyTechnician: !!item.anyTechnician,   // Fair Turn §19 (migration 600)
      // Smooth Refresh spec §11: an intentional, reasoned overbook is recorded on the row; only such rows are exempt from the guard.
      overbook: opts?.overbook ? { reason: opts.overbook.reason, byUserId: ctx.userId ?? null } : null,
    }, { userId: ctx.userId ?? null, actorType: 'user' });
    const id: string = await this.db.transaction().execute(async (trx) => {
      if (item.technicianId && !opts?.skipConflict) {
        // Serialize concurrent bookings for the same technician on the same day, then re-check against committed rows. The
        // service already did a pre-check, but front-desk booking and the customer app both INSERT this table, so two
        // requests can pass their pre-checks before either commits; the advisory lock + re-inside-the-txn read closes that.
        const key = `${ctx.tenantId}|${item.technicianId}|${item.date}`;
        await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
        const ex = (await this.scoped(trx.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', item.date)
          .select(['id', 'technician_id', 'start_time', 'end_time', 'status']).execute())
          .map((a: any) => ({ appointmentId: a.id, technicianId: a.technician_id || undefined, startTime: a.start_time, endTime: a.end_time, status: a.status as PBStatus }));
        const conf = pbDetectTechnicianConflict(ex, item.technicianId!, item.startTime, item.endTime, opts?.bufferMinutes ?? 0);
        if (conf.status === 'conflict') throw new BookingConflictRace(conf.conflictingAppointmentId);
      }
      // Round 3 H2: holds are re-read here, under the hold lock — a hold placed after the service's pre-check is seen.
      await this.lockedHoldCheck(trx as unknown as Kysely<DB>, ctx, item.technicianId ?? null, item.date, opts?.holdGuard);
      return insertOn(trx as unknown as Kysely<DB>);
    }).catch((e: any) => { if (KyselyBookingRepository.isNoOverlapViolation(e)) throw new BookingConflictRace(); throw e; });
    const existing = await this.existingForConflict(ctx, item.date); const techs = await this._technicians(ctx);
    return this.rowToRow(ctx, { id, technician_id: item.technicianId, customer_id: item.customerId, customer_name: item.customerName, customer_phone: item.customerPhone, is_vip: item.isVip, source: item.source, services: item.services, appt_date: item.date, start_time: item.startTime, end_time: item.endTime, duration_minutes: pbDuration(item.services), status: item.status, deposit_status: item.depositStatus, notes: item.notes }, existing, techs, undefined, undefined, undefined, undefined, await this.clock(ctx));
  }
  async update(ctx: BookingContext, id: string, patch: Partial<BkItem>, opts?: UpdateOptions): Promise<boolean> {
    const cur = await this.booking(ctx, id); if (!cur) return false;
    const set: any = { updated_at: sql`now()`, version: sql`version + 1` };
    if (patch.customerName !== undefined) set.customer_name = patch.customerName;
    if (patch.customerPhone !== undefined) set.customer_phone = patch.customerPhone || null;
    if (patch.notes !== undefined) set.notes = patch.notes || null;
    if (patch.isVip !== undefined) set.is_vip = patch.isVip;
    if (patch.services) { set.services = JSON.stringify(patch.services); set.duration_minutes = pbDuration(patch.services); set.end_time = pbAddMinutes(cur.startTime, pbDuration(patch.services)); }
    const changed = Object.keys(set).filter((k) => k !== 'updated_at' && k !== 'version');
    const durationChanged = patch.services != null && set.end_time !== cur.endTime;
    if (opts?.overbook) { set.overbook_ok = true; set.overbook_reason = opts.overbook.reason; set.overbook_by_user_id = ctx.userId ?? null; }
    try { await this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      // §69: an add-on that lengthens the visit is re-validated against the technician's day before it is saved.
      if (durationChanged && cur.technicianId && !opts?.overbook) await this.lockedConflictCheck(k, ctx, cur.technicianId, cur.date, cur.startTime, set.end_time, opts?.bufferMinutes ?? 0, id);
      let q = this.scoped(k.updateTable('pos_tech_appointments'), ctx).set(set).where('id', '=', id);
      if (opts?.expectedVersion != null) q = q.where('version', '=', opts.expectedVersion);
      const r: any = await q.executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BookingVersionConflict(await this.currentVersion(k, ctx, id));
      // appointment.updated — which fields changed, never their values (§95: no customer name / phone / notes in an event)
      if (this.outbox && changed.length && Number(r?.numUpdatedRows ?? 0) > 0) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, aggregateType: 'appointment', aggregateId: id,
        actorId: ctx.userId ?? undefined, actorType: 'user', payload: { appointmentId: id, technicianId: cur.technicianId ?? null, date: cur.date, changedFields: changed.map((k) => k === 'is_vip' ? 'isVip' : k === 'customer_name' ? 'customerName' : k === 'customer_phone' ? 'customerPhone' : k) } }));
    }); } catch (e: any) {
      if (KyselyBookingRepository.isNoOverlapViolation(e)) throw new BookingConflictRace();
      throw e;
    }
    return true;
  }
  private changeMeta(ctx: BookingContext) {
    return { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: ctx.role ?? null, actorId: ctx.userId ?? null, source: 'booking' as const };
  }
  /** The technician and day of a status change's appointment (ids + a date, §95); nothing when the row was not read. */
  private statusEventScope(before: { technician_id?: unknown; appt_date?: unknown } | undefined): { technicianId?: string | null; date?: string | null } {
    if (!before) return {};
    return { technicianId: before.technician_id ? String(before.technician_id) : null, date: before.appt_date ? this.isoDate(before.appt_date) : null };
  }
  async setStatus(ctx: BookingContext, id: string, st: PBStatus): Promise<boolean> {
    let before: any;
    try { before = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(['status', 'technician_id', 'appt_date']).executeTakeFirst(); } catch { before = undefined; }
    // §18/§60: the status UPDATE, its audit row (§169 — audit stays separate) and the domain event commit together.
    // Merge Sep 2026 (developer tree): 'in_service' also records start_source = 'pos', and the linked queue ticket /
    // queue item / ticket follow the appointment's state — inside the SAME transaction now, not as separate writes.
    const STATUS_EVENT: Partial<Record<string, typeof DOMAIN_EVENTS[keyof typeof DOMAIN_EVENTS]>> = {
      confirmed: DOMAIN_EVENTS.APPOINTMENT_CONFIRMED, completed: DOMAIN_EVENTS.APPOINTMENT_COMPLETED,
      cancelled: DOMAIN_EVENTS.APPOINTMENT_CANCELED, no_show: DOMAIN_EVENTS.APPOINTMENT_NO_SHOW,
      // Smooth Refresh spec §3/§17: a POS check-in reached other devices only through the 15 s safety sync — it wrote the
      // status but emitted nothing. Same event the Technician app already emits for its check-in.
      checked_in: DOMAIN_EVENTS.CUSTOMER_CHECKED_IN,
      // Decision 38: 'arrived' has no event of its own; appointment.updated tells other devices the row changed.
      arrived: DOMAIN_EVENTS.APPOINTMENT_UPDATED,
      // B-14 (Oct 20 2026): "Start service" from the Booking board was the one move with NO domain event — other screens
      // learned of it only from a direct push. appointment.updated { status: 'in_service' }: the projection fans it out to
      // serviceStarted + queueUpdated + appointmentUpdated (the queue item and tech ticket move in this same transaction).
      in_service: DOMAIN_EVENTS.APPOINTMENT_UPDATED,
    };
    const patch: any = { status: st, updated_at: sql`now()` };
    if (st === 'in_service') patch.start_source = 'pos';
    if (st === 'arrived') patch.arrived_at = sql`now()`;   // Decision 38: server time
    // Phase 12 (#27): the move goes through the APPOINTMENT machine (409 on a move it does not list — e.g. cancelling or
    // no-showing a completed visit, whose cascade also cancelled the paid ticket), and the UPDATE is conditional on the
    // status read — a concurrent writer gets 409 instead of a lost update. The cascades below move only the linked rows
    // their own machines allow (a cancelled tech ticket is not revived into service).
    const from = before?.status as string | undefined;
    if (from) assertTransition(APPOINTMENT, from, st);
    let raced = false;
    const done = await this.db.transaction().execute(async (trx) => {
      let q = this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set(patch).where('id', '=', id).where(canMoveToSql(APPOINTMENT, st));
      if (from) q = q.where('status', '=', from);
      // §43 (Oct 21 2026): the row's version after the write rides on the event (aggregateVersion); a client drops a stale frame.
      // check:silent-catch: a status write's error is the caller's error (it used to read as "raced").
      const res: any = await q.returning(['version']).executeTakeFirst();
      const ok = !!res;
      if (!ok) { raced = !!from; return false; }
      const versionAfter = res?.version != null ? Number(res.version) : undefined;
      await recordAppointmentChanges(trx as unknown as Kysely<DB>, this.changeMeta(ctx), id, 'status_changed', [{ field: 'status', old: before?.status, new: st }]);
      const tqStatus = st === 'in_service' ? 'in_service' : st === 'completed' || (st as string) === 'service_done' ? 'service_done' : st === 'cancelled' ? 'cancelled' : st === 'no_show' ? 'no_show' : 'assigned';
      // Phase 12 (#27, check:state-transitions V1): 'serving' is a TICKET status — the queue item's is in_service (its CHECK
      // never allowed 'serving', and this write's error was swallowed: the queue item never left 'waiting')
      const qStatus = st === 'in_service' ? 'in_service' : st === 'completed' || (st as string) === 'service_done' ? 'completed' : st === 'cancelled' ? 'cancelled' : st === 'no_show' ? 'cancelled' : 'waiting';
      if (st === 'in_service' || st === 'cancelled' || st === 'no_show' || st === 'completed' || (st as string) === 'service_done') {
        await trx.updateTable('pos_tech_queue_tickets').set({ status: tqStatus, ...(st === 'in_service' ? { start_source: 'pos', started_at: new Date() } : {}), updated_at: new Date() })
          .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', id).where(canMoveToSql(TECH_QUEUE_TICKET, tqStatus) as any).executeTakeFirst().catch(() => undefined);
        await trx.updateTable('pos_queue_items').set({ status: qStatus, updated_at: sql`now()` })
          .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', id).where(canMoveToSql(QUEUE_ITEM, qStatus) as any).executeTakeFirst().catch(() => undefined);
        if (st === 'cancelled') {
          await trx.updateTable('tickets').set({ status: 'cancelled', updated_at: sql`now()` })
            .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
        }
      }
      const eventType = STATUS_EVENT[st];
      if (eventType && this.outbox) {
        await this.outbox.write(trx, createDomainEvent({
          eventType, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'appointment', aggregateId: id, aggregateVersion: versionAfter, actorId: ctx.userId ?? undefined, actorType: 'user',
          // 200-technician mandate §22 (M5): the technician and the day ride along (ids + a date, §95) — a board showing other
          // technicians or another day skips its grid reload; unknown (no row read) → the keys are absent, never guessed
          payload: { appointmentId: id, previousStatus: before?.status ?? null, status: st, ...this.statusEventScope(before) },
        }));
      }
      return true;
    });
    if (raced) { const now: any = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select('status').executeTakeFirst().catch(() => undefined); if (now) throw new InvalidStateTransitionError(APPOINTMENT, now.status, st, 'concurrent'); }
    return done;
  }
  /** 23P01 = migration 426/482's no-overlap EXCLUDE refused the write: the database is the last line of defense (§7–§9). */
  private static isNoOverlapViolation(e: any): boolean {
    return !!e && (e.code === '23P01' || /no_overlap|exclusion constraint/i.test(String(e?.message || '')));
  }

  /** Conflict re-check INSIDE the transaction, serialized per technician + day by an advisory lock (§9/§10) — the same
   *  guard create() has had since Jul 2026; reschedule/update ran without it and swallowed the database's refusal. */
  private async lockedConflictCheck(trx: Kysely<DB>, ctx: BookingContext, technicianId: string, date: string, startTime: string, endTime: string, bufferMinutes: number, excludeId: string): Promise<void> {
    const key = `${ctx.tenantId}|${technicianId}|${date}`;
    await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
    const ex = (await this.scoped(trx.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date)
      .select(['id', 'technician_id', 'start_time', 'end_time', 'status']).execute())
      .map((a: any) => ({ appointmentId: a.id, technicianId: a.technician_id || undefined, startTime: a.start_time, endTime: a.end_time, status: a.status as PBStatus }));
    const conf = pbDetectTechnicianConflict(ex, technicianId, startTime, endTime, bufferMinutes, excludeId);
    if (conf.status === 'conflict') throw new BookingConflictRace(conf.conflictingAppointmentId);
  }

  /** Round 3 H2: the hold re-check INSIDE the write's transaction. Takes the branch-day hold lock (after the technician+day
   *  lock — the one lock order) that SlotHoldService.place also takes, then re-reads live holds: another session's hold
   *  overlapping the slot on this technician, or a "first available" hold (no technician), refuses the write. */
  private async lockedHoldCheck(trx: Kysely<DB>, ctx: BookingContext, technicianId: string | null, date: string, guard?: HoldGuard | null): Promise<void> {
    if (!guard || !ctx.branchId) return;
    // Oct 13 2026: the one shared in-transaction hold check (the customer app's writers use it too).
    const heldBy = await lockedForeignHold(trx, ctx.tenantId, ctx.branchId, technicianId, date, guard);
    if (heldBy) throw new BookingSlotHeld(heldBy);
  }

  /** The row's current version, for a VERSION_CONFLICT response (null when the row is gone). */
  private async currentVersion(trx: Kysely<DB>, ctx: BookingContext, id: string): Promise<number | null> {
    const r: any = await this.scoped(trx.selectFrom('pos_tech_appointments'), ctx).select(['version']).where('id', '=', id).executeTakeFirst();
    return r ? Number(r.version) : null;
  }

  async reschedule(ctx: BookingContext, id: string, technicianId: string | undefined, startTime: string, date: string | undefined, opts?: RescheduleOptions): Promise<boolean> {
    const cur = await this.booking(ctx, id); if (!cur) return false;
    const endTime = pbAddMinutes(startTime, pbDuration(cur.services));
    const newStatus = cur.status === 'no_show' || cur.status === 'cancelled' ? 'booked' : cur.status;
    const targetTech = technicianId ?? cur.technicianId ?? null;
    const targetDate = date ?? cur.date;
    // Smooth Refresh spec §9: every mutating write bumps `version`. §11: an intentional overbook is recorded ON the row
    // (who + why) and is the only thing the database's no-overlap guard exempts; moving an overbooked appointment to a
    // free slot clears the exemption again.
    const move: any = { start_time: startTime, end_time: endTime, updated_at: sql`now()`, version: sql`version + 1`,
                       overbook_ok: !!opts?.overbook, overbook_reason: opts?.overbook?.reason ?? null, overbook_by_user_id: opts?.overbook ? (ctx.userId ?? null) : null };
    if (technicianId) move.technician_id = technicianId; if (date) move.appt_date = date;
    // Phase 12 (#27): a cancelled / no-show visit rescheduled is booked again (the revival the APPOINTMENT machine lists);
    // the status is only written when it changes, through the machine and conditional on the status read
    const statusMoves = newStatus !== cur.status;
    if (statusMoves) assertTransition(APPOINTMENT, cur.status, newStatus);
    try {
      // §75: validate the new slot, move, release the old slot and commit ATOMICALLY — never release first and hope.
      await this.db.transaction().execute(async (trx) => {
        const k = trx as unknown as Kysely<DB>;
        if (targetTech && !opts?.overbook) await this.lockedConflictCheck(k, ctx, targetTech, targetDate, startTime, endTime, opts?.bufferMinutes ?? 0, id);
        await this.lockedHoldCheck(k, ctx, targetTech, targetDate, opts?.holdGuard);   // Round 3 H2: holds block a move too
        let q = statusMoves
          ? this.scoped(k.updateTable('pos_tech_appointments'), ctx).set({ ...move, status: newStatus }).where('id', '=', id).where('status', '=', cur.status).where(canMoveToSql(APPOINTMENT, newStatus))
          : this.scoped(k.updateTable('pos_tech_appointments'), ctx).set(move).where('id', '=', id);
        if (opts?.expectedVersion != null) q = q.where('version', '=', opts.expectedVersion);   // §14–§16: no blind last-write-wins
        const r: any = await q.executeTakeFirst();
        if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BookingVersionConflict(await this.currentVersion(k, ctx, id));
        // §18/§60: the move, its change-history rows and appointment.rescheduled commit together. The payload carries
        // the FROM and TO slot — ids, dates and times only (§95).
        await recordAppointmentChanges(k, this.changeMeta(ctx), id, 'rescheduled', [
          { field: 'start_time', old: cur.startTime, new: startTime },
          ...(technicianId ? [{ field: 'technician_id', old: cur.technicianId, new: technicianId }] : []),
          ...(date ? [{ field: 'appt_date', old: cur.date, new: date }] : []),
        ]);
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'appointment', aggregateId: id, actorId: ctx.userId ?? undefined, actorType: 'user',
          payload: { appointmentId: id, fromDate: cur.date ?? null, fromStartTime: cur.startTime, fromTechnicianId: cur.technicianId ?? null,
                     toDate: targetDate ?? null, toStartTime: startTime, toEndTime: endTime, toTechnicianId: targetTech, overbooked: !!opts?.overbook },
        }));
      });
    } catch (e: any) {
      if (KyselyBookingRepository.isNoOverlapViolation(e)) throw new BookingConflictRace();   // lost the race at the database
      throw e;   // a real failure is a real failure — it used to be swallowed here and reported as success
    }
    return true;
  }
  /** Merge Oct 12 2026 (other-chat booking concurrency): a reassign puts the booking in ANOTHER technician's day. It used to
   *  be an unchecked UPDATE outside any transaction whose database refusal (23P01) was swallowed into "ok = false". Now:
   *  the technician+day lock + in-transaction re-check (lockedConflictCheck), the caller's expectedVersion (§14–§16), the
   *  overbook flag written for an authorised overbook / cleared on a clean reassign (482), the change-history row and the
   *  linked queue / tech-queue rows all commit together; a lost race surfaces as BookingConflictRace (→ 409). */
  async assign(ctx: BookingContext, id: string, technicianId: string, opts?: RescheduleOptions): Promise<boolean> {
    const tech = (await this._technicians(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false;
    const cur = await this.booking(ctx, id); if (!cur) return false;
    const set: any = { technician_id: technicianId, updated_at: sql`now()`, version: sql`version + 1`,
                       overbook_ok: !!opts?.overbook, overbook_reason: opts?.overbook?.reason ?? null, overbook_by_user_id: opts?.overbook ? (ctx.userId ?? null) : null };
    try {
      await this.db.transaction().execute(async (trx) => {
        const k = trx as unknown as Kysely<DB>;
        if (!opts?.overbook) await this.lockedConflictCheck(k, ctx, technicianId, cur.date, cur.startTime, cur.endTime, opts?.bufferMinutes ?? 0, id);
        let q = this.scoped(k.updateTable('pos_tech_appointments'), ctx).set(set).where('id', '=', id);
        if (opts?.expectedVersion != null) q = q.where('version', '=', opts.expectedVersion);
        const r: any = await q.executeTakeFirst();
        if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BookingVersionConflict(await this.currentVersion(k, ctx, id));
        await recordAppointmentChanges(k, this.changeMeta(ctx), id, 'assigned', [{ field: 'technician_id', old: cur.technicianId ?? null, new: technicianId }]);
        await this.scoped(k.updateTable('pos_tech_queue_tickets'), ctx).set({ assigned_technician_id: technicianId, updated_at: sql`now()` }).where('appointment_id', '=', id).executeTakeFirst().catch(() => undefined);
        await this.scoped(k.updateTable('pos_queue_items'), ctx).set({ assigned_technician_id: technicianId, updated_at: sql`now()` }).where('appointment_id', '=', id).executeTakeFirst().catch(() => undefined);
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.APPOINTMENT_UPDATED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined, aggregateType: 'appointment', aggregateId: id,
          actorId: ctx.userId ?? undefined, actorType: 'user', payload: { appointmentId: id, technicianId, date: cur.date, changedFields: ['technicianId'], overbooked: !!opts?.overbook },
        }));
      });
    } catch (e: any) {
      if (KyselyBookingRepository.isNoOverlapViolation(e)) throw new BookingConflictRace();   // lost the race at the database
      throw e;
    }
    return true;
  }
  private keyCol(kind: 'queue' | 'techQueue' | 'serving') { return kind === 'queue' ? 'queue_idempotency_key' : kind === 'techQueue' ? 'tech_queue_idempotency_key' : 'serving_idempotency_key'; }
  async getKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving'): Promise<string | undefined> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.keyCol(kind)).executeTakeFirst().catch(() => undefined);
    return r ? (r[this.keyCol(kind)] || undefined) : undefined;
  }
  async setKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string): Promise<void> {
    await this.scoped(this.db.updateTable('pos_tech_appointments'), ctx).set({ [this.keyCol(kind)]: key, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst().catch(() => undefined);
  }
  async enqueueAppointment(ctx: BookingContext, id: string): Promise<void> {
    const appt: any = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).selectAll().executeTakeFirst().catch(() => undefined);
    if (!appt) return;
    const existingQ: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('appointment_id', '=', id).select('id').executeTakeFirst().catch(() => undefined);
    let queueItemId = existingQ?.id;
    const isServing = appt.status === 'in_service';
    const qStatus = isServing ? 'in_service' : 'waiting';   // Phase 12 (#27): was 'serving' — not a queue-item status (the insert failed)
    const tqStatus = isServing ? 'in_service' : 'assigned';

    if (!queueItemId) {
      const qIns: any = await this.db.insertInto('pos_queue_items').values({
        tenant_id: ctx.tenantId,
        branch_id: appt.branch_id || ctx.branchId,
        customer_id: appt.customer_id ?? null,
        customer_name: appt.customer_name ?? 'Guest',
        customer_phone: appt.customer_phone ?? null,
        is_vip: !!appt.is_vip,
        source: appt.source || 'manual',
        appointment_id: id,
        requested_services: typeof appt.services === 'string' ? appt.services : JSON.stringify(appt.services ?? []),
        priority: appt.is_vip ? 'vip' : 'normal',
        status: qStatus,
        assigned_technician_id: appt.technician_id ?? null,
        requested_technician_id: appt.technician_id ?? null,
        checked_in_at: sql`now()`,
        created_at: sql`now()`,
        updated_at: sql`now()`,
      } as any).returning('id').executeTakeFirst().catch(() => undefined);
      queueItemId = qIns?.id;
    } else if (isServing) {
      await this.scoped(this.db.updateTable('pos_queue_items'), ctx).set({ status: 'in_service', updated_at: sql`now()` } as any).where('id', '=', queueItemId).where(canMoveToSql(QUEUE_ITEM, 'in_service') as any).executeTakeFirst().catch(() => undefined);   // Phase 12: was 'serving' (refused by the CHECK, swallowed)
    }

    const existingTechQ: any = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('appointment_id', '=', id).select('id').executeTakeFirst().catch(() => undefined);
    if (!existingTechQ?.id) {
      await this.db.insertInto('pos_tech_queue_tickets').values({
        tenant_id: ctx.tenantId,
        branch_id: appt.branch_id || ctx.branchId,
        queue_item_id: queueItemId ?? null,
        appointment_id: id,
        customer_id: appt.customer_id ?? null,
        customer_name: appt.customer_name ?? 'Guest',
        customer_phone: appt.customer_phone ?? null,
        is_vip: !!appt.is_vip,
        source: appt.source || 'manual',
        requested_services: typeof appt.services === 'string' ? appt.services : JSON.stringify(appt.services ?? []),
        priority: appt.is_vip ? 'vip' : 'normal',
        status: tqStatus,
        assigned_technician_id: appt.technician_id ?? null,
        assigned_at: sql`now()`,
        started_at: isServing ? sql`now()` : null,
        created_at: sql`now()`,
        updated_at: sql`now()`,
      } as any).executeTakeFirst().catch(() => undefined);
    } else {
      await this.scoped(this.db.updateTable('pos_tech_queue_tickets'), ctx).set({
        status: tqStatus,
        assigned_technician_id: appt.technician_id ?? null,
        ...(isServing ? { started_at: sql`now()` } : {}),
        updated_at: sql`now()`,
      }).where('id', '=', existingTechQ.id).where(canMoveToSql(TECH_QUEUE_TICKET, tqStatus)).executeTakeFirst().catch(() => undefined);
    }
  }
}
