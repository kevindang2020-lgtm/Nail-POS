/**
 * The AIPowerSalon POS booking WIRE → board contracts (MERGE-CHECKLIST B7, Nov 13 2026).
 *
 * Field names are the ones the API actually sends (checked against payloads recorded from the real BookingService on
 * PGlite — see `src/tests/fixtures/wire/*.json`, re-validated by modules/booking `booking-board-wire.pgtest`):
 *   GET  /pos/booking/technicians   → one SERVER page of technician columns (12 a page; 200 → 17 pages)
 *   GET  /pos/booking/day-grid      → windows / blocked / open ranges per column + the whole day's appointments of THOSE columns
 *   GET  /pos/booking/availability  → bookable start times per technician for services (eligibility applied on the server)
 *   GET  /pos/booking/openings      → Best Matches: eligible first, then ranked
 * The mapping holds no business rule: eligibility, conflicts, protection, Fair Turn and the open ranges are the server's.
 * Local type names are prefixed `Wire…` on purpose — they describe only the fields this mapper reads (never a copy of
 * an API type).
 */
import { BookingDomainError, type BookingErrorCode } from '../domain/bookingErrors';
import type {
  Appointment,
  AppointmentSource,
  AppointmentStatus,
  AvailabilityGap,
  ID,
  ISODate,
  OpeningResult,
  ScheduleRange,
  ScheduleSegment,
  Service,
  Technician,
  TechnicianDay,
  TechnicianMatch,
} from '../domain/scheduleTypes';
import { hhmmToMinutes, minuteOfDay, toISO } from '../domain/time';

// ── the fields read from the wire ─────────────────────────────────────────────────────────────────────────────
export interface WireTechSummary { technicianId: string; name: string; rosterNumber: number; avatarUrl: string | null; available: boolean; workingToday: boolean }
export interface WireTechPage {
  date: string; technicians: WireTechSummary[]; total: number; totalAll: number; workingCount: number;
  page: number; pageSize: number; totalPages: number; located?: { technicianId: string; page: number; index: number } | null;
}
export interface WireServiceLine { serviceId: string; serviceName?: string; name?: string; durationMinutes?: number; priceCents?: number; priceOverrideCents?: number; isAddon?: boolean; parentServiceId?: string }
export interface WireAppointmentRow {
  appointmentId: string; tenantId?: string; branchId?: string; customerId?: string; customerName: string; customerPhone?: string;
  technicianId?: string | null; services?: WireServiceLine[]; source?: string; startTime: string; endTime: string; durationMinutes?: number;
  status: string; version?: number; date?: string; notes?: string; queueKey?: string;
}
export interface WireGridColumn {
  technicianId: string; name: string; available: boolean; avatarUrl?: string | null;
  windows: { start: number; end: number }[];
  blocked: { blockId?: string; startTime: string; endTime: string; reason?: string }[];
  openRanges: { start: number; end: number; minutes: number }[];
}
export interface WireDayGrid { date: string; openTime: string; closeTime: string; slotIntervalMinutes?: number; bufferMinutes?: number; columns: WireGridColumn[]; appointments?: WireAppointmentRow[] }
export interface WireAvailabilityRow { technicianId: string; name: string; slots: string[] }
export interface WireOpening { technicianId: string; name: string; rosterNumber: number; time: string; openSlots: number; rank: number }
export interface WireOpenings { date: string; durationMinutes: number; eligibleCount: number; withOpenings: number; openings: WireOpening[]; hasMore: boolean }
export interface WireCatalogService { serviceId: string; name: string; durationMinutes?: number; priceCents?: number }
export interface WireBlockedTime { blockId: string; technicianId: string; date: string; startTime: string; endTime: string; reason?: string }

export interface WireScope { tenantId: ID; branchId: ID; timezone: string }

// ── vocabulary ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The server's appointment statuses → the board's. checked-in / waiting customers are in the salon → "Arrived". */
export function mapStatus(s: string): AppointmentStatus {
  switch (s) {
    case 'booked': return 'scheduled';
    case 'confirmed': return 'confirmed';
    case 'arrived': case 'checked_in': case 'waiting': return 'arrived';
    case 'in_service': return 'in_service';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    case 'no_show': return 'no_show';
    default: return 'scheduled';
  }
}
/** Board status filter → the server's status filter value (the day grid filters on the server). */
export function serverStatusOf(s: AppointmentStatus): string | null {
  switch (s) {
    case 'scheduled': return 'booked';
    case 'rescheduled': return null;
    default: return s;
  }
}
export function mapSource(s: string | undefined): AppointmentSource {
  switch (s) {
    case 'walk_in': return 'walk_in';
    case 'online': case 'customer_app': return 'online';
    case 'phone': return 'phone';
    case 'ai': case 'ai_receptionist': return 'ai_phone';
    case 'google': return 'partner';
    default: return 'pos';
  }
}
/** Board source → the server's `source` on create. */
export function serverSourceOf(s: AppointmentSource | undefined): string {
  switch (s) {
    case 'walk_in': return 'walk_in';
    case 'phone': case 'ai_phone': return 'phone';
    case 'online': return 'online';
    default: return 'manual';
  }
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight. */
export function wireMinute(t: string): number {
  return hhmmToMinutes(String(t).slice(0, 5));
}

// ── mappers ───────────────────────────────────────────────────────────────────────────────────────────────────
export function mapAppointment(r: WireAppointmentRow, date: ISODate, scope: WireScope): Appointment {
  const d = r.date ?? date;
  const items = (r.services ?? []).map((l) => ({ serviceId: l.serviceId, name: l.serviceName ?? l.name ?? '', durationMinutes: l.durationMinutes ?? 0, priceCents: l.priceOverrideCents ?? l.priceCents ?? 0 }));
  return {
    id: r.appointmentId,
    tenantId: r.tenantId ?? scope.tenantId,
    branchId: r.branchId ?? scope.branchId,
    customerId: r.customerId ?? null,
    customerName: r.customerName,
    customerPhone: r.customerPhone ?? null,
    technicianId: r.technicianId ?? '',
    items,
    startAt: toISO(d, wireMinute(r.startTime), scope.timezone),
    endAt: toISO(d, wireMinute(r.endTime), scope.timezone),
    status: mapStatus(r.status),
    source: mapSource(r.source),
    // the wire does not say whether the customer asked for this technician; the server's reassignment rules apply
    requestedTechnician: false,
    // the server refuses ANY overlap (EXCLUDE guard + locked re-check), so the board needs no separate protection flag
    protected: false,
    notes: r.notes ?? null,
    version: r.version ?? 0,
    queueTicketId: r.queueKey ?? null,
  };
}

/** One server page of columns (+ their day grid) → the board's range, with the server's paging. */
export function mapScheduleRange(page: WireTechPage, grid: WireDayGrid, scope: WireScope, serverVersion: number): ScheduleRange {
  const date = grid.date;
  const iso = (m: number) => toISO(date, m, scope.timezone);
  const cols = new Map((grid.columns ?? []).map((c) => [c.technicianId, c]));
  const technicians: Technician[] = [];
  const segments: ScheduleSegment[] = [];
  const availability: Record<ID, AvailabilityGap[]> = {};
  page.technicians.forEach((t, i) => {
    const c = cols.get(t.technicianId);
    const windows = c ? [...c.windows].sort((a, b) => a.start - b.start) : [];
    technicians.push({
      id: t.technicianId, tenantId: scope.tenantId, branchId: scope.branchId, displayName: t.name, avatarUrl: t.avatarUrl,
      active: t.available, workingState: t.available && windows.length > 0 ? 'working' : 'off',
      serviceIds: null,   // eligibility stays on the server (one authority) — the board pre-checks nothing
      sortOrder: t.rosterNumber ?? i + 1,
    });
    windows.forEach((w, k) => segments.push({ id: `w-${t.technicianId}-${k}`, tenantId: scope.tenantId, branchId: scope.branchId, technicianId: t.technicianId, startAt: iso(w.start), endAt: iso(w.end), type: 'working' }));
    const blocked = (c?.blocked ?? []).map((b, k) => ({ id: b.blockId ?? `b-${t.technicianId}-${k}`, start: wireMinute(b.startTime), end: wireMinute(b.endTime), reason: b.reason ?? null }));
    blocked.forEach((b) => segments.push({ id: b.id, tenantId: scope.tenantId, branchId: scope.branchId, technicianId: t.technicianId, startAt: iso(b.start), endAt: iso(b.end), type: 'blocked', reason: b.reason }));
    // a hole between two working windows that no blocked time explains is the schedule's lunch / break
    for (let k = 1; k < windows.length; k++) {
      const s = windows[k - 1].end, e = windows[k].start;
      if (e <= s || blocked.some((b) => b.start <= s && b.end >= e)) continue;
      segments.push({ id: `br-${t.technicianId}-${k}`, tenantId: scope.tenantId, branchId: scope.branchId, technicianId: t.technicianId, startAt: iso(s), endAt: iso(e), type: 'break' });
    }
    availability[t.technicianId] = (c?.openRanges ?? []).map((r) => ({ technicianId: t.technicianId, startAt: iso(r.start), endAt: iso(r.end), durationMinutes: r.minutes, bookable: r.minutes >= 15 }));
  });
  const onPage = new Set(page.technicians.map((t) => t.technicianId));
  const appointments = (grid.appointments ?? []).filter((a) => a.technicianId && onPage.has(a.technicianId)).map((a) => mapAppointment(a, date, scope));
  const rosterNumbers: Record<ID, number> = {};
  for (const t of page.technicians) rosterNumbers[t.technicianId] = t.rosterNumber;
  return {
    tenantId: scope.tenantId, branchId: scope.branchId, date, timezone: scope.timezone,
    branchHours: { openAt: String(grid.openTime).slice(0, 5), closeAt: String(grid.closeTime).slice(0, 5) },
    technicians, appointments, segments, availability, serverVersion, updatedAt: new Date(serverVersion).toISOString(),
    paging: { total: page.total, totalAll: page.totalAll, workingCount: page.workingCount, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages, rosterNumbers },
  };
}

/** The unassigned / first-available column's appointments (no technician yet) — counted, never drawn in a column. */
export function unassignedAppointments(grid: WireDayGrid): WireAppointmentRow[] {
  return (grid.appointments ?? []).filter((a) => !a.technicianId);
}

export function mapTechnicianDay(range: ScheduleRange, technicianId: ID): TechnicianDay | null {
  const technician = range.technicians.find((t) => t.id === technicianId);
  if (!technician) return null;
  const date = range.date;
  const m = (iso: string) => minuteOfDay(iso, date, range.timezone);
  const segments = range.segments.filter((s) => s.technicianId === technicianId);
  const appointments = range.appointments.filter((a) => a.technicianId === technicianId);
  const availability = range.availability[technicianId] ?? [];
  const workingMinutes = segments.filter((s) => s.type === 'working').reduce((n, s) => n + (m(s.endAt) - m(s.startAt)), 0);
  const live = appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show');
  return {
    technician, date, timezone: range.timezone, appointments, segments, availability,
    summary: {
      workingMinutes,
      bookedMinutes: live.reduce((n, a) => n + (m(a.endAt) - m(a.startAt)), 0),
      openMinutes: availability.reduce((n, g) => n + g.durationMinutes, 0),
      appointmentCount: live.length,
    },
  };
}

/**
 * Find an Opening from the server's bookable starts (it already applied hours, schedule, breaks, blocked time,
 * bookings + buffer, holds and EXACT service eligibility). A run of consecutive starts is one gap: its size is from the
 * first start to the last start + the service duration.
 */
export function mapOpenings(rows: WireAvailabilityRow[], date: ISODate, durationMinutes: number, scope: WireScope, opts: { windowStart?: string; windowEnd?: string; slotIntervalMinutes?: number; limit?: number } = {}): OpeningResult[] {
  const step = opts.slotIntervalMinutes ?? 15;
  const from = opts.windowStart ? wireMinute(opts.windowStart) : -1;
  const to = opts.windowEnd ? wireMinute(opts.windowEnd) : 24 * 60;
  const out: OpeningResult[] = [];
  for (const r of rows) {
    const starts = r.slots.map(wireMinute).sort((a, b) => a - b);
    let runStart = 0;
    for (let i = 0; i < starts.length; i++) {
      if (i === 0 || starts[i] - starts[i - 1] !== step) runStart = i;
      let runEnd = i;
      while (runEnd + 1 < starts.length && starts[runEnd + 1] - starts[runEnd] === step) runEnd++;
      const s = starts[i];
      if (s < from || s + durationMinutes > to) continue;
      const gapStart = starts[runStart], gapEnd = starts[runEnd] + durationMinutes;
      out.push({ technicianId: r.technicianId, technicianName: r.name, startAt: toISO(date, s, scope.timezone), endAt: toISO(date, s + durationMinutes, scope.timezone), durationMinutes, gapDurationMinutes: gapEnd - gapStart });
    }
  }
  out.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.technicianName.localeCompare(b.technicianName));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Best Matches = the server's ranked openings (eligibility first, ranking second); reasons are words for the host. */
export function mapMatches(r: WireOpenings, scope: WireScope, reason: (key: 'rank' | 'openSlots' | 'roster', vars: Record<string, number>) => string): TechnicianMatch[] {
  return r.openings.map((o) => ({
    technicianId: o.technicianId,
    technicianName: o.name,
    // higher is better, from the server's own order (never re-ranked here)
    score: Math.max(1, r.withOpenings - o.rank + 1),
    earliestStartAt: o.time ? toISO(r.date, wireMinute(o.time), scope.timezone) : null,
    reasons: [reason('rank', { n: o.rank, total: r.eligibleCount }), reason('openSlots', { n: o.openSlots }), reason('roster', { n: o.rosterNumber })],
  }));
}

export function mapServices(list: WireCatalogService[], scope: WireScope): Service[] {
  return list.map((s) => ({ id: s.serviceId, tenantId: scope.tenantId, name: s.name, durationMinutes: s.durationMinutes ?? 0, priceCents: s.priceCents ?? 0, active: true }));
}

export function mapBlockedTime(b: WireBlockedTime, scope: WireScope): ScheduleSegment {
  return { id: b.blockId, tenantId: scope.tenantId, branchId: scope.branchId, technicianId: b.technicianId, startAt: toISO(b.date, wireMinute(b.startTime), scope.timezone), endAt: toISO(b.date, wireMinute(b.endTime), scope.timezone), type: 'blocked', reason: b.reason ?? null };
}

// ── errors ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The POS booking API's refusal codes → the board's domain errors. A raw database error never reaches the board: the
 * no-overlap EXCLUDE refusal (23P01) arrives as a 409 APPOINTMENT_CONFLICT / SCHEDULE_CHANGED_ELSEWHERE from the
 * service, and anything unknown becomes UNKNOWN (which reloads the schedule).
 */
export const POS_BOOKING_ERROR_CODES: Record<string, BookingErrorCode> = {
  APPOINTMENT_CONFLICT: 'APPOINTMENT_CONFLICT',
  SCHEDULE_CHANGED_ELSEWHERE: 'APPOINTMENT_CONFLICT',
  TECHNICIAN_DOUBLE_BOOKED: 'APPOINTMENT_CONFLICT',
  OVERBOOK_CONFIRMATION_REQUIRED: 'APPOINTMENT_CONFLICT',   // the board never overbooks; the classic board keeps the confirm-with-reason flow
  CUSTOMER_OVERLAPPING_APPOINTMENT: 'APPOINTMENT_CONFLICT',
  WINDOW_OVERLAPS_APPOINTMENT: 'APPOINTMENT_CONFLICT',
  NO_TECHNICIAN_AVAILABLE: 'TECHNICIAN_UNAVAILABLE',
  VERSION_CONFLICT: 'SCHEDULE_CHANGED',
  RESYNC_REQUIRED: 'SCHEDULE_CHANGED',
  OUTSIDE_TECHNICIAN_HOURS: 'TECHNICIAN_UNAVAILABLE',
  OUTSIDE_STORE_HOURS: 'TECHNICIAN_UNAVAILABLE',
  TECHNICIAN_NOT_SKILLED_FOR_SERVICES: 'TECHNICIAN_SERVICE_INELIGIBLE',
  TECHNICIAN_NOT_SKILLED: 'TECHNICIAN_SERVICE_INELIGIBLE',
  TECHNICIAN_NOT_FOUND: 'TECHNICIAN_UNAVAILABLE',
  TECHNICIAN_UNKNOWN: 'TECHNICIAN_UNAVAILABLE',
  DURATION_INVALID: 'INVALID_DURATION',
  BOOKING_NOT_FOUND: 'NOT_FOUND',
  BLOCKED_TIME_NOT_FOUND: 'NOT_FOUND',
  CANCEL_REASON_REQUIRED: 'VALIDATION_FAILED',
  CUSTOMER_NAME_REQUIRED: 'VALIDATION_FAILED',
  SERVICES_REQUIRED: 'VALIDATION_FAILED',
  DATE_START_REQUIRED: 'VALIDATION_FAILED',
  NEW_START_REQUIRED: 'VALIDATION_FAILED',
  TIME_FORMAT_INVALID: 'VALIDATION_FAILED',
  END_AFTER_START: 'VALIDATION_FAILED',
  DATE_INVALID: 'VALIDATION_FAILED',
  FORBIDDEN: 'PERMISSION_DENIED',
};

/** Any thrown host error ({ status, code, message, currentVersion }) → a board domain error. */
export function mapHostError(raw: unknown): BookingDomainError {
  if (BookingDomainError.is(raw)) return raw;
  const r = (raw ?? {}) as { status?: number; code?: string; body?: { code?: string; currentVersion?: number }; currentVersion?: number };
  const currentVersion = typeof r.currentVersion === 'number' ? r.currentVersion : typeof r.body?.currentVersion === 'number' ? r.body.currentVersion : undefined;
  const code = r.code ?? r.body?.code;
  const mapped: BookingErrorCode | undefined = (code && POS_BOOKING_ERROR_CODES[code])
    || (r.status === 409 ? 'APPOINTMENT_CONFLICT' : r.status === 403 ? 'PERMISSION_DENIED' : r.status === 404 ? 'NOT_FOUND' : r.status === 400 || r.status === 422 ? 'VALIDATION_FAILED' : undefined);
  // the server's own sentence stays in details for logs; the board shows its translated text for the code
  return new BookingDomainError(mapped ?? 'UNKNOWN', undefined, { hostCode: code ?? null, status: r.status ?? null }, currentVersion);
}
