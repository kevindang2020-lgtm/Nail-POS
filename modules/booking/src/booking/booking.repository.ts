// booking.repository.ts — persistence port + in-memory adapter for POS Booking (the master appointment module).
// Tenant-scoped bookings + service catalog + technicians (skills). A different tenant sees its own (empty) data —
// isolation. Availability reuses the shared conflict engine. Check-in / move-to-queue / move-to-tech-queue /
// start-service are idempotent (a retry never duplicates a downstream ticket).
import {
  Money, POSBookingFullState, POSBookingAppointmentRow, POSBookingKpisFull, PBServiceLine, PBStatus, PBSource, PBDepositStatus,
  BookingSettings, DEFAULT_BOOKING_SETTINGS, BookingIntegrationStatus, DEFAULT_INTEGRATION_STATUS, BookingFilters, type PBTechDaySchedule,
  pbAddMinutes, pbDuration, pbDetectTechnicianConflict, pbComputeAvailability, pbArrivingSoon, BookingConflictRace, BookingVersionConflict, computeBookingAggregates, pbLateness, pbWithLateness,
} from './booking.dto';
import { clampPageSize, clampPage, APPOINTMENT_DISPLAY_STATUSES, isAwaitingArrival, foldVi } from '@aipowersalon/api-contracts';

export interface BookingContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface BkItem {
  appointmentId: string; technicianId: string | null; customerId?: string; customerName: string; customerPhone?: string; isVip: boolean;
  services: PBServiceLine[]; source: PBSource; date: string; startTime: string; endTime: string; status: PBStatus; depositStatus: PBDepositStatus;
  depositCents: Money; notes: string; queueKey?: string; techQueueKey?: string; servingKey?: string; createdAt: string; updatedAt: string;
  /** Smooth Refresh spec §9/§15: optimistic-concurrency version (1 on create). */
  version?: number;
  /** Fair Turn §19 (migration 600): booked as "any technician" — the engine picked who; counts under COUNT_ANY_TECH_APPOINTMENTS */
  anyTechnician?: boolean;
  /** Decision 38: when the customer was marked arrived. */
  arrivedAt?: string | null;
  /** §11: an intentional, reasoned overbook — exempt from the overlap guard. */
  overbookOk?: boolean; overbookReason?: string;
}
export interface TechRec { technicianId: string; name: string; available: boolean; skills: string[]; avatarUrl?: string | null; rating?: number | null; reviewCount?: number; }
/** 200-technician mandate (Oct 23 2026): the board's light roster row — enough to filter, search and page the WHOLE branch
 *  without loading skills, ratings or schedules for 200 people. `searchText` is lower-case name / phone digits / e-mail and is
 *  used only for matching on the server; it never leaves the API. Order: name, then id (the roster number "#n"). */
export interface RosterRec { technicianId: string; name: string; available: boolean; searchText: string; }
/** query() options that only the server's own callers set (never from a request): limit the rows to some technicians'
 *  columns (+ the unassigned column) and return the whole day instead of one page (the day grid). */
export interface BookingQueryOpts { technicianIds?: string[]; includeUnassigned?: boolean; unbounded?: boolean; }
export interface SvcRec { serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: Money; }

/** Smooth Refresh spec §9/§11/§14: reschedule/update options — the client's expectedVersion (stale copy → VERSION_CONFLICT),
 *  the tenant buffer for the in-transaction re-check, and an explicit, reasoned overbook (exempts the row from the guard). */
/** Round 3 H2: re-read live booking holds INSIDE the write's transaction (under bookingHoldLockKey) — another session's
 *  hold overlapping [fromMs, toMs) on this technician (or a no-technician hold) refuses the write with BookingSlotHeld. */
export interface HoldGuard { fromMs: number; toMs: number; ownSessionId: string | null }
export interface RescheduleOptions { expectedVersion?: number; bufferMinutes?: number; overbook?: { reason: string } | null; holdGuard?: HoldGuard | null }
export type UpdateOptions = RescheduleOptions;

// Options for an atomic create: the per-tenant buffer to apply in the transactional re-check, and skipConflict (set when
// the salon legitimately allows overbooking or a manager overrode) which bypasses the lock+re-check and just inserts.
export interface BookingCreateOpts { bufferMinutes?: number; skipConflict?: boolean; /** §11: reasoned overbook recorded on the row and exempt from the guard. */ overbook?: { reason: string } | null; holdGuard?: HoldGuard | null; }

export interface BookingRepositoryPort {
  /** Constitution 8: true when the repository writes domain events in its transactions. */
  emitsDomainEvents?(): boolean;
  /** extras TEAM MANAGEMENT 05 (round 10): each listed technician's own branch (null = salon-wide) and its name, tenant-scoped. */
  technicianBranches?(ctx: BookingContext, technicianIds: string[]): Promise<Map<string, { branchId: string | null; name: string | null }>>;
  settings(ctx: BookingContext): Promise<BookingSettings>;
  integrationStatus(ctx: BookingContext): Promise<BookingIntegrationStatus>;
  today(): string;
  /** The BRANCH's clock (Oct 2 2026): its day, minute of day and zone (branches.timezone → America/New_York). Everything
   *  that means "today" or "now" on the booking board reads this — not today(), which only knows the default zone. */
  clock(ctx: BookingContext): Promise<{ today: string; nowMinute: number; timeZone: string }>;
  /** Current minute of the server day (0–1439) — used by dayGrid's same-day past-time clamp (§6). */
  nowMinuteOfDay(): number;
  query(ctx: BookingContext, f: BookingFilters, opts?: BookingQueryOpts): Promise<POSBookingFullState>;
  booking(ctx: BookingContext, id: string): Promise<BkItem | null>;
  detail(ctx: BookingContext, id: string): Promise<POSBookingAppointmentRow | null>;
  /** Spec §25: ids (+ stamp) of appointments in this tenant/branch whose updated_at is at or after `since`, oldest
   *  first, at most `limit`. Optional: a repository without it makes the service answer RESYNC_REQUIRED. */
  /** Rows stamped at or after `since`, in (updated_at, id) order. M4 paging: `opts.after` = strictly after that
   *  (stamp in whole ms, id as text) key — the order rows come in; `opts.upto` = no row stamped after it (the sweep's
   *  fixed upper bound). */
  changedSince?(ctx: BookingContext, since: Date, limit: number, opts?: { after?: { ms: number; id: string }; upto?: Date }): Promise<{ id: string; updatedAt: string }[]>;
  /** Every technician (not archived) of the scope; with `ids`, only those (the visible page — mandate §18/§27). */
  technicians(ctx: BookingContext, ids?: string[]): Promise<TechRec[]>;
  /** The light roster (mandate §8): optional — without it the service derives one from technicians(). */
  technicianRoster?(ctx: BookingContext): Promise<RosterRec[]>;
  /** Many appointment rows at once (the change feed — mandate §26: no per-row detail() chain). Optional. */
  detailsMany?(ctx: BookingContext, ids: string[]): Promise<POSBookingAppointmentRow[]>;
  serviceCatalog(ctx: BookingContext): Promise<SvcRec[]>;
  existingForConflict(ctx: BookingContext, date: string): Promise<{ appointmentId: string; technicianId?: string; customerId?: string; startTime: string; endTime: string; status: PBStatus }[]>;
  availability(ctx: BookingContext, date: string, durationMinutes: number, technicianId?: string): Promise<{ technicianId: string; name: string; slots: string[] }[]>;
  /** Weekly schedule rows for the given weekday (0=Sun..6=Sat) keyed by technician; null entry = no row. */
  /** `date` (salon-local YYYY-MM-DD) lays that date's shift override over the weekly template (F4, Oct 30 2026). */
  techSchedules(ctx: BookingContext, dayOfWeek: number, date?: string): Promise<Record<string, PBTechDaySchedule>>;
  /** That date's technician_blocked_times keyed by technician. */
  blockedTimes(ctx: BookingContext, date: string): Promise<Record<string, { blockId?: string; startTime: string; endTime: string; reason: string }[]>>;
  /** §9 write path: create one blocked window for a technician on a date. Returns the new block id. */
  addBlockedTime(ctx: BookingContext, input: { technicianId: string; date: string; startTime: string; endTime: string; reason: string; note?: string }): Promise<{ blockId: string }>;
  /** §9 write path: delete a blocked window (tenant/branch-scoped). True when a row was removed. */
  removeBlockedTime(ctx: BookingContext, blockId: string): Promise<boolean>;
  create(ctx: BookingContext, item: BkItem, opts?: BookingCreateOpts): Promise<POSBookingAppointmentRow>;
  update(ctx: BookingContext, id: string, patch: Partial<BkItem>, opts?: UpdateOptions): Promise<boolean>;
  setStatus(ctx: BookingContext, id: string, st: PBStatus): Promise<boolean>;
  reschedule(ctx: BookingContext, id: string, technicianId: string | undefined, startTime: string, date: string | undefined, opts?: RescheduleOptions): Promise<boolean>;
  /** Merge Oct 12 2026: a reassign is a write of ANOTHER technician's time — same guard as a move (lock + re-check + version + overbook flag). */
  assign(ctx: BookingContext, id: string, technicianId: string, opts?: RescheduleOptions): Promise<boolean>;
  nextSeq(): number;
  getKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving'): Promise<string | undefined>;
  setKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string): Promise<void>;
  enqueueAppointment(ctx: BookingContext, id: string): Promise<void>;
}

const now = () => new Date().toISOString();
const TODAY = '2026-06-06';

export class InMemoryBookingRepository implements BookingRepositoryPort {
  async techSchedules(): Promise<Record<string, PBTechDaySchedule>> { return {}; }
  private blocks = new Map<string, { blockId: string; technicianId: string; date: string; startTime: string; endTime: string; reason: string; note?: string }[]>();
  async blockedTimes(ctx: BookingContext, date: string): Promise<Record<string, { blockId?: string; startTime: string; endTime: string; reason: string }[]>> {
    const out: Record<string, { blockId?: string; startTime: string; endTime: string; reason: string }[]> = {};
    for (const b of this.blocks.get(ctx.tenantId) || []) if (b.date === date) (out[b.technicianId] ||= []).push({ blockId: b.blockId, startTime: b.startTime, endTime: b.endTime, reason: b.reason });
    return out;
  }
  async addBlockedTime(ctx: BookingContext, input: { technicianId: string; date: string; startTime: string; endTime: string; reason: string; note?: string }): Promise<{ blockId: string }> {
    const blockId = 'blk_' + this.nextSeq();
    const rows = this.blocks.get(ctx.tenantId) || [];
    rows.push({ blockId, ...input });
    this.blocks.set(ctx.tenantId, rows);
    return { blockId };
  }
  async removeBlockedTime(ctx: BookingContext, blockId: string): Promise<boolean> {
    const rows = this.blocks.get(ctx.tenantId) || [];
    const next = rows.filter((b) => b.blockId !== blockId);
    this.blocks.set(ctx.tenantId, next);
    return next.length !== rows.length;
  }
  private store = new Map<string, BkItem[]>();
  private techs = new Map<string, TechRec[]>();
  private catalog = new Map<string, SvcRec[]>();
  private seq = 5000;
  nextSeq() { return ++this.seq; }
  today() { return TODAY; }
  /** Overridable in tests: null → 0 (no clamp effect on the fixed in-memory TODAY). */
  nowMinuteOverride: number | null = null;
  nowMinuteOfDay() { return this.nowMinuteOverride ?? 0; }
  async clock(_ctx: BookingContext) { return { today: this.today(), nowMinute: this.nowMinuteOfDay(), timeZone: DEFAULT_BOOKING_SETTINGS.timezone }; }

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.techs.set(tenantId, []); this.catalog.set(tenantId, []); return; }
    const cat: SvcRec[] = [
      { serviceId: 'svc_mani', name: 'Signature Manicure', categoryName: 'Manicure', durationMinutes: 45, priceCents: 5500 },
      { serviceId: 'svc_pedi', name: 'Spa Pedicure', categoryName: 'Pedicure', durationMinutes: 55, priceCents: 6500 },
      { serviceId: 'svc_gel', name: 'Gel Add-on', categoryName: 'Add-on', durationMinutes: 15, priceCents: 1500 },
      { serviceId: 'svc_wax', name: 'Eyebrow Wax', categoryName: 'Waxing', durationMinutes: 20, priceCents: 2200 },
    ];
    this.catalog.set(tenantId, cat);
    this.techs.set(tenantId, [
      { technicianId: 'tech_mia', name: 'Mia', available: true, skills: ['Manicure', 'Add-on'] },
      { technicianId: 'tech_ava', name: 'Ava', available: true, skills: ['Pedicure', 'Manicure'] },
      { technicianId: 'tech_leo', name: 'Leo', available: false, skills: ['Waxing', 'Manicure'] },
      { technicianId: 'tech_zoe', name: 'Zoe', available: true, skills: ['Manicure', 'Pedicure'] },
    ]);
    const svc = (id: string): PBServiceLine => { const s = cat.find((x) => x.serviceId === id)!; return { serviceId: s.serviceId, serviceName: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents }; };
    const mk = (id: string, techId: string | null, cust: string, phone: string, vip: boolean, source: PBSource, serviceIds: string[], start: string, status: PBStatus, dep: PBDepositStatus = 'not_required', depC = 0): BkItem => {
      const services = serviceIds.map(svc); const dur = pbDuration(services);
      return { appointmentId: id, technicianId: techId, customerId: 'c_' + id, customerName: cust, customerPhone: phone, isVip: vip, services, source, date: TODAY, startTime: start, endTime: pbAddMinutes(start, dur), status, depositStatus: dep, depositCents: depC, notes: '', createdAt: now(), updatedAt: now() };
    };
    this.store.set(tenantId, [
      mk('bk_5101', 'tech_mia', 'Grace Kim', '+18565550101', true, 'phone', ['svc_mani', 'svc_gel'], '10:00', 'booked'),
      mk('bk_5102', 'tech_ava', 'Nora Patel', '+18565550102', false, 'online', ['svc_pedi'], '09:30', 'in_service'),
      mk('bk_5103', 'tech_leo', 'Ivy Park', '+18565550104', false, 'google', ['svc_wax'], '11:00', 'confirmed'),
      mk('bk_5104', 'tech_zoe', 'Liv Chen', '+18565550103', false, 'ai', ['svc_mani'], '10:30', 'checked_in', 'paid', 2000),
      mk('bk_5105', 'tech_mia', 'Mia Wong', '+18565550105', false, 'walk_in', ['svc_mani'], '13:00', 'booked'),
      mk('bk_5106', 'tech_ava', 'Zoe Diaz', '+18565550106', false, 'customer_app', ['svc_pedi'], '14:00', 'completed', 'paid', 1500),
      mk('bk_5107', 'tech_zoe', 'Ada Brooks', '+18565550107', false, 'phone', ['svc_mani'], '15:00', 'cancelled'),
      mk('bk_5108', 'tech_leo', 'Bea Cruz', '+18565550108', false, 'online', ['svc_wax'], '16:00', 'no_show'),
    ]);
  }
  private L(ctx: BookingContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  async booking(ctx: BookingContext, id: string) { return this.L(ctx).find((a) => a.appointmentId === id) || null; }
  async settings(_ctx: BookingContext) { return DEFAULT_BOOKING_SETTINGS; }
  async integrationStatus(_ctx: BookingContext) { return DEFAULT_INTEGRATION_STATUS; } // honest: not configured until a tenant connects them
  async technicians(ctx: BookingContext, ids?: string[]) { this.ensure(ctx.tenantId); const all = (this.techs.get(ctx.tenantId) || []).slice(); if (!ids) return all; const want = new Set(ids); return all.filter((t) => want.has(t.technicianId)); }
  async serviceCatalog(ctx: BookingContext) { this.ensure(ctx.tenantId); return (this.catalog.get(ctx.tenantId) || []).slice(); }
  async existingForConflict(ctx: BookingContext, date: string) { return this.L(ctx).filter((a) => a.date === date).map((a) => ({ appointmentId: a.appointmentId, technicianId: a.technicianId || undefined, customerId: a.customerId, startTime: a.startTime, endTime: a.endTime, status: a.status })); }

  async availability(ctx: BookingContext, date: string, durationMinutes: number, technicianId?: string) {
    const s = DEFAULT_BOOKING_SETTINGS; const techs = (await this.technicians(ctx)).filter((t) => !technicianId || t.technicianId === technicianId);
    const dur = durationMinutes > 0 ? durationMinutes : s.defaultServiceDurationMinutes;
    return techs.map((t) => {
      const mine = this.L(ctx).filter((a) => a.date === date && a.technicianId === t.technicianId).map((a) => ({ startTime: a.startTime, endTime: a.endTime, status: a.status }));
      return { technicianId: t.technicianId, name: t.name, slots: t.available ? pbComputeAvailability(s.openTime, s.closeTime, s.slotIntervalMinutes, dur, s.bufferMinutes, mine) : [] };
    });
  }

  private toRowSync(ctx: BookingContext, a: BkItem, existing: { appointmentId: string; technicianId?: string; startTime: string; endTime: string; status: PBStatus }[], techs: TechRec[]): POSBookingAppointmentRow {
    const conf = a.technicianId ? pbDetectTechnicianConflict(existing, a.technicianId, a.startTime, a.endTime, DEFAULT_BOOKING_SETTINGS.bufferMinutes, a.appointmentId) : { status: 'none' as const };
    const tech = techs.find((t) => t.technicianId === a.technicianId);
    const row: POSBookingAppointmentRow = {
      appointmentId: a.appointmentId, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: a.customerId, customerName: a.customerName, customerPhone: a.customerPhone, isVip: a.isVip,
      customerAvatarUrl: null,
      technicianId: a.technicianId || undefined, technicianName: tech ? tech.name : undefined, services: a.services, source: a.source, startTime: a.startTime, endTime: a.endTime, durationMinutes: pbDuration(a.services),
      version: a.version ?? 1, ...(a.overbookOk ? { overbooked: true } : {}), status: a.status, depositStatus: a.depositStatus, conflictStatus: conf.status, queueKey: a.queueKey, notes: a.notes, createdAt: a.createdAt, updatedAt: a.updatedAt,
      date: a.date, arrivedAt: a.arrivedAt ?? null,
    };
    return pbWithLateness(row, this.today(), this.nowMinuteOfDay(), DEFAULT_BOOKING_SETTINGS.lateGraceMinutes);   // Decision 38, same rule as the real repository
  }
  async changedSince(ctx: BookingContext, since: Date, limit: number, opts?: { after?: { ms: number; id: string }; upto?: Date }) {
    const key = (a: BkItem) => Math.floor(Date.parse(a.updatedAt));
    return this.L(ctx).filter((a) => key(a) >= since.getTime() && (!opts?.upto || key(a) <= opts.upto.getTime())
      && (!opts?.after || key(a) > opts.after.ms || (key(a) === opts.after.ms && a.appointmentId > opts.after.id)))
      .sort((x, y) => (key(x) - key(y)) || (x.appointmentId < y.appointmentId ? -1 : x.appointmentId > y.appointmentId ? 1 : 0))
      .slice(0, limit).map((a) => ({ id: a.appointmentId, updatedAt: a.updatedAt }));
  }
  async detail(ctx: BookingContext, id: string) { const a = await this.booking(ctx, id); if (!a) return null; const existing = await this.existingForConflict(ctx, a.date); const techs = await this.technicians(ctx); return this.toRowSync(ctx, a, existing, techs); }

  private filtered(ctx: BookingContext, f: BookingFilters, day: BkItem[], cat: SvcRec[], existingByDate: Map<string, any[]>): BkItem[] {
    let rows = day.slice();
    if (f.search) { const q = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ rows = rows.filter((a) => [a.customerName, a.customerPhone, a.notes, ...a.services.map((x) => x.serviceName)].some((x) => foldVi(x).includes(q))); }
    if (f.technicianId) rows = rows.filter((a) => a.technicianId === f.technicianId);
    if (f.status) rows = rows.filter((a) => f.status === 'late' ? !!pbLateness(a.date, a.startTime, a.status, this.today(), this.nowMinuteOfDay(), DEFAULT_BOOKING_SETTINGS.lateGraceMinutes).lateness : a.status === f.status);
    if (f.source) rows = rows.filter((a) => a.source === f.source);
    if (f.serviceCategory) rows = rows.filter((a) => a.services.some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory));
    if (f.depositStatus) rows = rows.filter((a) => a.depositStatus === f.depositStatus);
    if (f.conflictOnly) { const buf = DEFAULT_BOOKING_SETTINGS.bufferMinutes; rows = rows.filter((a) => a.technicianId && pbDetectTechnicianConflict(existingByDate.get(a.date) || [], a.technicianId, a.startTime, a.endTime, buf, a.appointmentId).status !== 'none'); }
    return rows;
  }

  async query(ctx: BookingContext, f: BookingFilters, opts?: BookingQueryOpts): Promise<POSBookingFullState> {
    const date = f.date || TODAY;
    const only = opts?.technicianIds ? new Set(opts.technicianIds) : null;
    const dayAll = this.L(ctx).filter((a) => (f.from && f.to) ? (a.date >= f.from && a.date <= f.to) : a.date === date)
      .filter((a) => !only || (a.technicianId ? only.has(a.technicianId) : opts?.includeUnassigned !== false));
    const cat = await this.serviceCatalog(ctx); const techs = await this.technicians(ctx);
    const dates = [...new Set(dayAll.map((a) => a.date))];
    const existingByDate = new Map<string, any[]>();
    for (const d of dates) existingByDate.set(d, await this.existingForConflict(ctx, d));
    const matched = this.filtered(ctx, f, dayAll, cat, existingByDate);
    const buf = DEFAULT_BOOKING_SETTINGS.bufferMinutes;
    const conflictCount = dayAll.filter((a) => a.technicianId && pbDetectTechnicianConflict(existingByDate.get(a.date) || [], a.technicianId, a.startTime, a.endTime, buf, a.appointmentId).status !== 'none').length;
    const kpis: POSBookingKpisFull = {
      totalBookingsToday: dayAll.length,
      confirmedBookings: dayAll.filter((a) => isAwaitingArrival(a.status)).length,
      arrivedBookings: dayAll.filter((a) => a.status === 'arrived').length,
      lateBookings: dayAll.filter((a) => !!pbLateness(a.date, a.startTime, a.status, this.today(), this.nowMinuteOfDay(), DEFAULT_BOOKING_SETTINGS.lateGraceMinutes).lateness).length,
      arrivingSoonBookings: pbArrivingSoon(dayAll, this.today(), this.nowMinuteOfDay()),
      checkedInBookings: dayAll.filter((a) => a.status === 'checked_in').length,
      waitingBookings: dayAll.filter((a) => a.status === 'waiting').length,
      inServiceBookings: dayAll.filter((a) => a.status === 'in_service').length,
      completedBookings: dayAll.filter((a) => a.status === 'completed').length,
      cancelledBookings: dayAll.filter((a) => a.status === 'cancelled').length,
      noShowBookings: dayAll.filter((a) => a.status === 'no_show').length,
      onlineBookings: dayAll.filter((a) => a.source === 'online' || a.source === 'customer_app').length,
      googleBookings: dayAll.filter((a) => a.source === 'google').length,
      aiBookings: dayAll.filter((a) => a.source === 'ai').length,
      conflictCount,
      depositsCollectedCents: dayAll.reduce((acc, a) => acc + (a.depositStatus === 'paid' ? a.depositCents : 0), 0),
    };
    const page = opts?.unbounded ? 1 : clampPage(f.page), pageSize = opts?.unbounded ? Math.max(1, matched.length) : clampPageSize(f.pageSize, 50);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((a) => this.toRowSync(ctx, a, existingByDate.get(a.date) || [], techs));
    return {
      kpis, dateRange: { from: f.from || date, to: f.to || date, timezone: DEFAULT_BOOKING_SETTINGS.timezone },
      bookings: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: [...APPOINTMENT_DISPLAY_STATUSES],
        sources: ['walk_in', 'phone', 'online', 'google', 'ai', 'customer_app', 'manual'],
        technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.name })),
        services: cat.map((s) => ({ serviceId: s.serviceId, name: s.name, priceCents: s.priceCents, durationMinutes: s.durationMinutes })),
        serviceCategories: [...new Set(cat.map((s) => s.categoryName))],
        branches: [{ branchId: ctx.branchId || 'br_cherryhill', name: 'Cherry Hill' }],
      },
      settings: DEFAULT_BOOKING_SETTINGS,
      integrationStatus: DEFAULT_INTEGRATION_STATUS,
      aggregates: computeBookingAggregates(dayAll),
    };
  }

  async create(ctx: BookingContext, item: BkItem, opts?: BookingCreateOpts) {
    if (item.technicianId && !opts?.skipConflict) {
      const ex = await this.existingForConflict(ctx, item.date);
      const conf = pbDetectTechnicianConflict(ex, item.technicianId, item.startTime, item.endTime, opts?.bufferMinutes ?? 0);
      if (conf.status === 'conflict') throw new BookingConflictRace(conf.conflictingAppointmentId);
    }
    this.L(ctx).push(item); const existing = await this.existingForConflict(ctx, item.date); const techs = await this.technicians(ctx); return this.toRowSync(ctx, item, existing, techs); }
  // In-memory twin of the Kysely repository's concurrency rules (Smooth Refresh spec §9/§14/§69): version bump, the
  // caller's expectedVersion, and the same technician-overlap re-check the database path performs inside its transaction.
  private guardVersion(a: BkItem, opts?: RescheduleOptions) { if (opts?.expectedVersion != null && (a.version ?? 1) !== opts.expectedVersion) throw new BookingVersionConflict(a.version ?? 1); }
  private guardOverlap(ctx: BookingContext, a: BkItem, techId: string | null, date: string, start: string, end: string, opts?: RescheduleOptions) {
    if (!techId || opts?.overbook) return;
    const ex = this.L(ctx).filter((x) => x.date === date && x.appointmentId !== a.appointmentId && !x.overbookOk)
      .map((x) => ({ appointmentId: x.appointmentId, technicianId: x.technicianId || undefined, startTime: x.startTime, endTime: x.endTime, status: x.status }));
    const conf = pbDetectTechnicianConflict(ex, techId, start, end, opts?.bufferMinutes ?? 0, a.appointmentId);
    if (conf.status === 'conflict') throw new BookingConflictRace(conf.conflictingAppointmentId);
  }
  async update(ctx: BookingContext, id: string, patch: Partial<BkItem>, opts?: UpdateOptions) {
    const a = await this.booking(ctx, id); if (!a) return false; this.guardVersion(a, opts);
    const newEnd = patch.services ? pbAddMinutes(a.startTime, pbDuration(patch.services)) : a.endTime;
    if (newEnd !== a.endTime) this.guardOverlap(ctx, a, a.technicianId, a.date, a.startTime, newEnd, opts);
    Object.assign(a, patch); a.endTime = newEnd; if (opts?.overbook) { a.overbookOk = true; a.overbookReason = opts.overbook.reason; }
    a.version = (a.version ?? 1) + 1; a.updatedAt = now(); return true;
  }
  async setStatus(ctx: BookingContext, id: string, st: PBStatus) { const a = await this.booking(ctx, id); if (!a) return false; a.status = st; if (st === 'arrived') a.arrivedAt = now(); a.updatedAt = now(); return true; }
  async reschedule(ctx: BookingContext, id: string, technicianId: string | undefined, startTime: string, date: string | undefined, opts?: RescheduleOptions) {
    const a = await this.booking(ctx, id); if (!a) return false; this.guardVersion(a, opts);
    const techId = technicianId ?? a.technicianId; const day = date ?? a.date; const end = pbAddMinutes(startTime, pbDuration(a.services));
    this.guardOverlap(ctx, a, techId, day, startTime, end, opts);
    if (technicianId) a.technicianId = technicianId; if (date) a.date = date; a.startTime = startTime; a.endTime = end;
    if (a.status === 'no_show' || a.status === 'cancelled') a.status = 'booked';
    a.overbookOk = !!opts?.overbook; a.overbookReason = opts?.overbook?.reason;
    a.version = (a.version ?? 1) + 1; a.updatedAt = now(); return true;
  }
  async assign(ctx: BookingContext, id: string, technicianId: string, opts?: RescheduleOptions) {
    const a = await this.booking(ctx, id); const t = (await this.technicians(ctx)).find((x) => x.technicianId === technicianId); if (!a || !t) return false; this.guardVersion(a, opts);
    this.guardOverlap(ctx, a, t.technicianId, a.date, a.startTime, a.endTime, opts);
    a.technicianId = t.technicianId; a.overbookOk = !!opts?.overbook; a.overbookReason = opts?.overbook?.reason;
    a.version = (a.version ?? 1) + 1; a.updatedAt = now(); return true;
  }
  async getKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving') { const a = await this.booking(ctx, id); if (!a) return undefined; return kind === 'queue' ? a.queueKey : kind === 'techQueue' ? a.techQueueKey : a.servingKey; }
  async setKey(ctx: BookingContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string) { const a = await this.booking(ctx, id); if (!a) return; if (kind === 'queue') a.queueKey = key; else if (kind === 'techQueue') a.techQueueKey = key; else a.servingKey = key; }
  async enqueueAppointment(_ctx: BookingContext, _id: string): Promise<void> { /* no-op for in-memory double */ }
}
