// booking.kysely.repository.ts — production BookingRepositoryPort over Postgres (Kysely). POS Booking shares the
// pos_tech_appointments table with tech-appointments, so all appointment CRUD, reschedule/assign/status, the services
// JSONB array and the three idempotency keys (queue / tech-queue / serving) are REAL persisted columns. Technicians +
// their skill categories are real (technicians + technician_services → services → service_categories); the service
// catalog is real (services + service_categories). Scope is session-derived (tenant + branch-or-null).
//
// Honest fallbacks: settings/integration use the documented defaults (no per-tenant booking-settings table here);
// depositsCollectedCents is 0 (pos_tech_appointments tracks deposit_status, not a deposit amount in cents); today() is
// the server's current date.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { recordAppointmentChanges } from '@aipowersalon/appointments';
import type { BookingRepositoryPort, BookingContext,  BkItem, TechRec, SvcRec, BookingCreateOpts, RescheduleOptions, UpdateOptions, HoldGuard } from './booking.repository';
import { lockedForeignHold } from '../customer-booking/booking-hold-locked-check';
import {
  POSBookingFullState, POSBookingAppointmentRow, POSBookingKpisFull, BookingFilters, PBStatus, PBSource, PBDepositStatus,
  BookingSettings, DEFAULT_BOOKING_SETTINGS, BookingIntegrationStatus, DEFAULT_INTEGRATION_STATUS,
  pbAddMinutes, pbDuration, pbDetectTechnicianConflict, pbComputeAvailability, BookingConflictRace, BookingSlotHeld, BookingVersionConflict, computeBookingAggregates, pbLateness, pbWithLateness,
  type PBTechDaySchedule,
} from './booking.dto';
import { clampPageSize, clampPage, APPOINTMENT_DISPLAY_STATUSES, isAwaitingArrival } from '@aipowersalon/api-contracts';
import { businessDate, zonedParts } from '@aipowersalon/date-time';
import { branchTimeZone, assertTransition, canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { buildMediaUrl } from '@aipowersalon/media';

const parseServices = (v: any): any[] => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
type ExRow = { appointmentId: string; technicianId?: string; customerId?: string; startTime: string; endTime: string; status: PBStatus };

export class KyselyBookingRepository implements BookingRepositoryPort {
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

  private async _technicians(ctx: BookingContext): Promise<TechRec[]> {
    const techs = await this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech')
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .where('tech.status', '!=', 'archived')
      .select(['tech.id', 'tech.full_name', 'tech.is_active', 'tech.status', 'tech.service_eligibility_mode', 'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'])
      .execute().catch(() => []);
    const idsArr = techs.map((t: any) => t.id);
    const links = idsArr.length ? await this.scoped(this.db.selectFrom('technician_services as ts'), ctx, 'ts').innerJoin('services as s', 's.id', 'ts.service_id').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('ts.technician_id', 'in', idsArr).select(['ts.technician_id as tid', 'ts.service_id as sid', 'c.name as cat']).execute().catch(() => []) : [];
    const skillBy: Record<string, Set<string>> = {};
    const servicesBy: Record<string, Set<string>> = {};
    for (const l of links) {
      (skillBy[l.tid] ||= new Set()).add(l.cat || 'General');
      if (l.sid) (servicesBy[l.tid] ||= new Set()).add(String(l.sid));
    }
    // Per-technician rating from the shared reviews table (technician-attributed since 066). Fail-open to no rating.
    const ratingBy: Record<string, { sum: number; count: number }> = {};
    if (idsArr.length) {
      const revs = await this.scoped(this.db.selectFrom('reviews'), ctx).where('technician_id', 'in', idsArr).select(['technician_id as tid', 'rating']).execute().catch(() => []);
      for (const r of (revs as any[])) { const rt = Number(r.rating); if (!Number.isFinite(rt)) continue; (ratingBy[r.tid] ||= { sum: 0, count: 0 }); ratingBy[r.tid].sum += rt; ratingBy[r.tid].count += 1; }
    }
    return techs.map((t: any) => {
      const agg = ratingBy[t.id];
      const photo = t.tech_avatar_url || t.gtp_avatar_url || t.user_avatar_url;
      return { technicianId: t.id, name: t.full_name || t.id, available: !!t.is_active, skills: [...(skillBy[t.id] || [])], approvedServiceIds: [...(servicesBy[t.id] || [])], legacySkillsUnconfigured: t.service_eligibility_mode === 'legacy_unconfigured', avatarUrl: photo ? buildMediaUrl(photo) : null,
        rating: agg && agg.count ? Math.round((agg.sum / agg.count) * 10) / 10 : null, reviewCount: agg ? agg.count : 0 };
    });
  }
  async technicians(ctx: BookingContext) { return this._technicians(ctx); }

  async techSchedules(ctx: BookingContext, dayOfWeek: number): Promise<Record<string, PBTechDaySchedule>> {
    const rows = await this.scoped(this.db.selectFrom('technician_schedules'), ctx)
      .where('day_of_week', '=', dayOfWeek)
      .select(['technician_id', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working', 'shifts', 'breaks'])
      .execute().catch(() => []);
    const out: Record<string, PBTechDaySchedule> = {};
    for (const r of rows as any[]) {
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
      .execute().catch(() => []);
    const out: Record<string, { blockId?: string; startTime: string; endTime: string; reason: string }[]> = {};
    for (const r of rows as any[]) (out[r.technician_id] ||= []).push({ blockId: r.id, startTime: String(r.start_time).slice(0, 5), endTime: String(r.end_time).slice(0, 5), reason: r.reason || 'blocked' });

    // Mandate §51 (P1 2.3): approved time-off blocks booking slots in the shared booking guard
    try {
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);
      let timeOffQ = (this.db as any).selectFrom('technician_time_off')
        .where('tenant_id', '=', ctx.tenantId)
        .where('status', '=', 'approved')
        .where('starts_at', '<=', dayEnd)
        .where('ends_at', '>=', dayStart)
        .select(['id', 'technician_id', 'starts_at', 'ends_at', 'reason']);
      if (ctx.branchId) {
        timeOffQ = timeOffQ.where((eb: any) => eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', ctx.branchId)]));
      }
      const timeOffRows = await timeOffQ.execute().catch(() => []);
      for (const to of timeOffRows as any[]) {
        const s = new Date(to.starts_at);
        const e = new Date(to.ends_at);
        const startTime = s <= dayStart ? '00:00' : s.toISOString().slice(11, 16);
        const endTime = e >= dayEnd ? '23:59' : e.toISOString().slice(11, 16);
        (out[to.technician_id] ||= []).push({
          blockId: String(to.id),
          startTime,
          endTime,
          reason: to.reason || 'time_off',
        });
      }
    } catch {}

    return out;
  }
  async addBlockedTime(ctx: BookingContext, input: { technicianId: string; date: string; startTime: string; endTime: string; reason: string; note?: string }): Promise<{ blockId: string }> {
    const row: any = await this.db.insertInto('technician_blocked_times').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: input.technicianId,
      block_date: input.date, start_time: input.startTime, end_time: input.endTime,
      reason: input.reason, note: input.note ?? null, created_by_user_id: ctx.userId || null,
    } as any).returning('id').executeTakeFirst();
    return { blockId: String(row?.id) };
  }
  async removeBlockedTime(ctx: BookingContext, blockId: string): Promise<boolean> {
    const res = await this.scoped(this.db.deleteFrom('technician_blocked_times'), ctx)
      .where('id', '=', blockId)
      .executeTakeFirst().catch(() => null);
    return Number((res as any)?.numDeletedRows ?? 0) > 0;
  }

  private cols = ['id', 'technician_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'services', 'appt_date', 'start_time', 'end_time', 'duration_minutes', 'status', 'deposit_status', 'notes', 'queue_idempotency_key', 'tech_queue_idempotency_key', 'serving_idempotency_key', 'arrived_at', 'overbook_ok'] as const;

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
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.cols as any).executeTakeFirst().catch(() => undefined);
    return r ? this.rowToBkItem(r) : null;
  }
  async changedSince(ctx: BookingContext, since: Date, limit: number): Promise<{ id: string; updatedAt: string }[]> {
    // Served by idx_pos_tech_appointments_tenant_branch_updated (482). updated_at is stamped on every UPDATE by the
    // 483 trigger, whichever module writes the row.
    const rows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('updated_at', '>=', since as any)
      .select(['id', 'updated_at']).orderBy('updated_at', 'asc').orderBy('id', 'asc').limit(limit).execute();
    return rows.map((r: any) => ({ id: String(r.id), updatedAt: new Date(r.updated_at).toISOString() }));
  }
  async detail(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow | null> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.cols as any).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    const tq: any = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('appointment_id', '=', id).select('status').executeTakeFirst().catch(() => undefined);
    const existing = await this.existingForConflict(ctx, this.isoDate((r as any).appt_date)); const techs = await this._technicians(ctx);
    let custAvatar: string | null = null;
    if (r.customer_id) {
      const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', r.customer_id).select(['avatar_url']).executeTakeFirst().catch(() => undefined);
      if (c?.avatar_url) custAvatar = c.avatar_url;
    }
    const st = await this.settings(ctx);
    return this.rowToRow(ctx, r, existing, techs, tq?.status, custAvatar, st.bufferMinutes, st.lateGraceMinutes, await this.clock(ctx));
  }
  async existingForConflict(ctx: BookingContext, date: string): Promise<ExRow[]> {
    const rows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date).select(['id', 'technician_id', 'customer_id', 'start_time', 'end_time', 'status']).execute().catch(() => []);
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

  async query(ctx: BookingContext, f: BookingFilters): Promise<POSBookingFullState> {
    const clk = await this.clock(ctx);
    const date = f.date || clk.today;
    let qb = this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx);
    qb = (f.from && f.to) ? qb.where('appt_date', '>=', f.from).where('appt_date', '<=', f.to) : qb.where('appt_date', '=', date);
    const dayRows = await qb.select(this.cols as any).execute().catch(() => []);
    const existingByDate = new Map<string, ExRow[]>();
    for (const d of [...new Set(dayRows.map((a: any) => a.appt_date))] as string[]) existingByDate.set(d, await this.existingForConflict(ctx, d));
    const cat = await this._catalog(ctx); const st = await this.settings(ctx); const buf = st.bufferMinutes; const techs = await this._technicians(ctx);
    const today = clk.today, nowMin = clk.nowMinute;
    const lateOf = (a: any) => pbLateness(this.isoDate(a.appt_date), a.start_time, a.status as PBStatus, today, nowMin, st.lateGraceMinutes).lateness;
    const confOf = (a: any) => a.technician_id ? pbDetectTechnicianConflict(existingByDate.get(a.appt_date) || [], a.technician_id, a.start_time, a.end_time, buf, a.id).status : 'none';

    let rows = dayRows.slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((a: any) => [a.customer_name, a.customer_phone, a.notes, ...parseServices(a.services).map((x: any) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(q))); }
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
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 50);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const tqRows: any[] = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).select(['appointment_id', 'status']).execute().catch(() => []);
    const tqMap = new Map<string, string>();
    for (const tq of tqRows) if (tq.appointment_id) tqMap.set(tq.appointment_id, tq.status);

    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const customerIds = [...new Set(pageRows.map((a: any) => a.customer_id).filter(Boolean))];
    const custRows = customerIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', customerIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const custAvatarMap: Record<string, string | null> = {};
    for (const c of custRows as any[]) {
      if (c.id && c.avatar_url) custAvatarMap[c.id] = c.avatar_url;
    }
    const pageRowItems = pageRows.map((a: any) => this.rowToRow(ctx, a, existingByDate.get(a.appt_date) || [], techs, tqMap.get(a.id), a.customer_id ? custAvatarMap[a.customer_id] : null, buf, st.lateGraceMinutes, clk));
    return {
      kpis, dateRange: { from: f.from || date, to: f.to || date, timezone: clk.timeZone },
      bookings: { items: pageRowItems, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: [...APPOINTMENT_DISPLAY_STATUSES],   // Decision 38: incl. arrived and the computed late
        sources: ['walk_in', 'phone', 'online', 'google', 'ai', 'customer_app', 'manual'],
        technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.name })),
        services: cat.map((s) => ({ serviceId: s.serviceId, name: s.name, priceCents: s.priceCents, durationMinutes: s.durationMinutes })),
        serviceCategories: [...new Set(cat.map((s) => s.categoryName))],
        branches: [{ branchId: ctx.branchId || 'br_cherryhill', name: 'Cherry Hill' }],
      },
      settings: this._settings(),
      integrationStatus: DEFAULT_INTEGRATION_STATUS,
      aggregates: computeBookingAggregates(dayRows.map((a: any) => ({ source: a.source, status: a.status, services: parseServices(a.services) }))),
    };
  }

  async create(ctx: BookingContext, item: BkItem, opts?: BookingCreateOpts): Promise<POSBookingAppointmentRow> {
    const values = {
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: item.technicianId, customer_id: item.customerId || null, customer_name: item.customerName, customer_phone: item.customerPhone || null, is_vip: item.isVip,
      source: item.source, services: JSON.stringify(item.services) as any, appt_date: item.date, start_time: item.startTime, end_time: item.endTime, duration_minutes: pbDuration(item.services), status: item.status, deposit_status: item.depositStatus, notes: item.notes || null,
      // Smooth Refresh spec §11: an intentional, reasoned overbook is recorded on the row; only such rows are exempt from the guard.
      ...(item.anyTechnician ? { any_technician: true } : {}),   // Fair Turn §19 (migration 600)
      ...(opts?.overbook ? { overbook_ok: true, overbook_reason: opts.overbook.reason, overbook_by_user_id: ctx.userId ?? null } : {}),
    } as any;
    const insertOn = async (exec: Kysely<DB>) => ((await exec.insertInto('pos_tech_appointments').values(values).returning(['id']).executeTakeFirstOrThrow()) as any).id as string;
    // §18: the appointment row and its appointment.created event commit together — so BOTH paths run in a
    // transaction now (the no-technician path used to be a bare insert).
    const emitCreated = async (trx: Kysely<DB>, newId: string) => {
      if (!this.outbox) return;
      await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
        aggregateType: 'appointment', aggregateId: newId, actorId: ctx.userId ?? undefined, actorType: 'user',
        // §95: ids and scheduling facts only — never the customer's name or phone
        payload: { appointmentId: newId, technicianId: item.technicianId ?? null, customerId: item.customerId ?? null, date: item.date,
                   startTime: item.startTime, endTime: item.endTime, source: item.source, status: item.status, serviceCount: item.services.length },
      }));
    };
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
      const newId = await insertOn(trx);
      await emitCreated(trx, newId);
      return newId;
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
  async setStatus(ctx: BookingContext, id: string, st: PBStatus): Promise<boolean> {
    let before: any;
    try { before = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select('status').executeTakeFirst(); } catch { before = undefined; }
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
    };
    const patch: any = { status: st, updated_at: sql`now()` };
    if (st === 'in_service') patch.start_source = 'pos';
    if (st === 'arrived') patch.arrived_at = sql`now()`;   // Decision 38: server time
    // Phase 12 (#27): the move goes through the APPOINTMENT machine (409 on a move it does not list — e.g. cancelling or
    // no-showing a completed visit, whose cascade also cancelled the paid ticket), and the UPDATE is conditional on the
    // status read — a concurrent writer gets 409 instead of a lost update. The cascades below move only the linked rows
    // their own machines allow (a cancelled tech ticket is not revived into service).
    const from = (before as any)?.status as string | undefined;
    if (from) assertTransition(APPOINTMENT, from, st);
    let raced = false;
    const done = await this.db.transaction().execute(async (trx) => {
      let q = this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set(patch).where('id', '=', id).where(canMoveToSql(APPOINTMENT, st) as any);
      if (from) q = q.where('status', '=', from);
      const res = await q.executeTakeFirst().catch(() => undefined);
      const ok = Number((res as any)?.numUpdatedRows ?? 0) > 0;
      if (!ok) { raced = !!from; return false; }
      await recordAppointmentChanges(trx as unknown as Kysely<DB>, this.changeMeta(ctx), id, 'status_changed', [{ field: 'status', old: (before as any)?.status, new: st }]);
      const tqStatus = st === 'in_service' ? 'in_service' : st === 'completed' || (st as string) === 'service_done' ? 'service_done' : st === 'cancelled' ? 'cancelled' : st === 'no_show' ? 'no_show' : 'assigned';
      // Phase 12 (#27, check:state-transitions V1): 'serving' is a TICKET status — the queue item's is in_service (its CHECK
      // never allowed 'serving', and this write's error was swallowed: the queue item never left 'waiting')
      const qStatus = st === 'in_service' ? 'in_service' : st === 'completed' || (st as string) === 'service_done' ? 'completed' : st === 'cancelled' ? 'cancelled' : st === 'no_show' ? 'cancelled' : 'waiting';
      if (st === 'in_service' || st === 'cancelled' || st === 'no_show' || st === 'completed' || (st as string) === 'service_done') {
        await trx.updateTable('pos_tech_queue_tickets').set({ status: tqStatus, ...(st === 'in_service' ? { start_source: 'pos', started_at: new Date() } : {}), updated_at: new Date() } as any)
          .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', id).where(canMoveToSql(TECH_QUEUE_TICKET, tqStatus) as any).executeTakeFirst().catch(() => undefined);
        await trx.updateTable('pos_queue_items').set({ status: qStatus, updated_at: sql`now()` } as any)
          .where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', id).where(canMoveToSql(QUEUE_ITEM, qStatus) as any).executeTakeFirst().catch(() => undefined);
        if (st === 'cancelled') {
          await trx.updateTable('tickets').set({ status: 'cancelled', updated_at: sql`now()` } as any)
            .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst().catch(() => undefined);
        }
      }
      const eventType = STATUS_EVENT[st];
      if (eventType && this.outbox) {
        await this.outbox.write(trx, createDomainEvent({
          eventType, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'appointment', aggregateId: id, actorId: ctx.userId ?? undefined, actorType: 'user',
          payload: { appointmentId: id, previousStatus: (before as any)?.status ?? null, status: st },
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
          ? this.scoped(k.updateTable('pos_tech_appointments'), ctx).set({ ...move, status: newStatus }).where('id', '=', id).where('status', '=', cur.status).where(canMoveToSql(APPOINTMENT, newStatus) as any)
          : this.scoped(k.updateTable('pos_tech_appointments'), ctx).set(move).where('id', '=', id);
        if (opts?.expectedVersion != null) q = q.where('version', '=', opts.expectedVersion);   // §14–§16: no blind last-write-wins
        const r: any = await q.executeTakeFirst();
        if (Number(r?.numUpdatedRows ?? 0) === 0) throw new BookingVersionConflict(await this.currentVersion(k, ctx, id));
        // §18/§60: the move, its change-history rows and appointment.rescheduled commit together. The payload carries
        // the FROM and TO slot — ids, dates and times only (§95).
        await recordAppointmentChanges(k, this.changeMeta(ctx), id, 'rescheduled', [
          { field: 'start_time', old: cur.startTime, new: startTime },
          ...(technicianId ? [{ field: 'technician_id', old: (cur as any).technicianId, new: technicianId }] : []),
          ...(date ? [{ field: 'appt_date', old: (cur as any).date, new: date }] : []),
        ]);
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED, tenantId: ctx.tenantId, branchId: ctx.branchId ?? undefined,
          aggregateType: 'appointment', aggregateId: id, actorId: ctx.userId ?? undefined, actorType: 'user',
          payload: { appointmentId: id, fromDate: (cur as any).date ?? null, fromStartTime: cur.startTime, fromTechnicianId: (cur as any).technicianId ?? null,
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
        await this.scoped(k.updateTable('pos_tech_queue_tickets'), ctx).set({ assigned_technician_id: technicianId, updated_at: sql`now()` } as any).where('appointment_id', '=', id).executeTakeFirst().catch(() => undefined);
        await this.scoped(k.updateTable('pos_queue_items'), ctx).set({ assigned_technician_id: technicianId, updated_at: sql`now()` } as any).where('appointment_id', '=', id).executeTakeFirst().catch(() => undefined);
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
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.keyCol(kind) as any).executeTakeFirst().catch(() => undefined);
    return r ? ((r as any)[this.keyCol(kind)] || undefined) : undefined;
  }
  async setKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string): Promise<void> {
    await this.scoped(this.db.updateTable('pos_tech_appointments'), ctx).set({ [this.keyCol(kind)]: key, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst().catch(() => undefined);
  }
  async enqueueAppointment(ctx: BookingContext, id: string): Promise<void> {
    const appt: any = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).selectAll().executeTakeFirst().catch(() => undefined);
    if (!appt) return;
    const existingQ: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('appointment_id', '=', id).select('id').executeTakeFirst().catch(() => undefined);
    let queueItemId = existingQ?.id;
    const isServing = appt.status === 'in_service';
    const qStatus = isServing ? 'in_service' : (appt.technician_id ? 'assigned' : 'waiting');
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
      } as any).where('id', '=', existingTechQ.id).where(canMoveToSql(TECH_QUEUE_TICKET, tqStatus) as any).executeTakeFirst().catch(() => undefined);
    }
  }
}
