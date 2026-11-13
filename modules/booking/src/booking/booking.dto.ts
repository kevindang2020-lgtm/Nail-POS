import { zonedParts } from '@aipowersalon/date-time';
import type { Money } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { BookingFilters } from '@aipowersalon/api-contracts/tenant';
import type { BookingFilters } from '@aipowersalon/api-contracts/tenant';
import { CHAIR_HOLDING_STATUSES, isAwaitingArrival, isCheckInEligible } from '@aipowersalon/api-contracts';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
// booking.dto.ts — AIPowerSalon POS Booking contracts.
// Endpoints derive tenantId/branchId from the authenticated session — never from the client (§28).
// Naming: Booking = the manage/create/reschedule workflow; appointment = the calendar record.

export type ColorKey = "pink" | "purple" | "blue" | "green" | "orange";
export type TechStatus = "available" | "busy" | "break" | "lunch" | "off";
export type AppointmentStatus =
  | "pending_confirmation" | "confirmed" | "arrived" | "checked_in" | "waiting"
  | "assigned" | "serving" | "ready_checkout" | "completed" | "cancelled" | "no_show";
export type BookingSource =
  | "pos_manual" | "phone_call" | "ai_phone" | "customer_app"
  | "online_booking" | "google_booking_link" | "walk_in_optional";

// ---- §9 KPIs ----
export interface BookingKpis {
  todaysAppointments: number;
  todaysAppointmentsTrendPercent: number;
  confirmedAppointments: number;
  confirmedPercentOfTotal: number;
  pendingConfirmation: number;
  pendingPercentOfTotal: number;
  walkIns: number;
  walkInsPercentOfTotal: number;
  availableSlots: number;
}

// ---- §11 calendar ----
export interface CalendarTechnician {
  id: string; displayName: string; roleLabel: string; avatarUrl?: string;
  colorKey: ColorKey; status: TechStatus;
}
export interface CalendarAppointment {
  id: string; customerId: string; customerName: string; technicianId: string;
  serviceNames: string[]; startTime: string; endTime: string;
  status: AppointmentStatus; source: BookingSource;
}
export interface CalendarOpenSlot {
  technicianId: string; startTime: string; endTime: string;
  durationMinutes: number; serviceIdsSupported: string[];
}
export interface BookingCalendarResponse {
  startDate: string; endDate: string; view: "day" | "week";
  technicians: CalendarTechnician[]; appointments: CalendarAppointment[]; openSlots: CalendarOpenSlot[];
}

// ---- §13 create ----
export interface CreateAppointmentRequest {
  customerId?: string; customerPhone?: string; customerFirstName?: string; customerLastName?: string;
  serviceIds: string[]; technicianId?: string;
  date: string; startTime: string; endTime?: string; estimatedDurationMinutes?: number;
  notes?: string; source: Exclude<BookingSource, "walk_in_optional">; confirmationRequired?: boolean;
}

// ---- §16 reschedule ----
export interface RescheduleAppointmentRequest {
  newTechnicianId?: string; newDate: string; newStartTime: string; newEndTime?: string;
  reason?: string; notifyCustomer?: boolean;
}

// ---- §20 upcoming ----
export interface UpcomingAppointment {
  appointmentId: string; customerId: string; customerName: string;
  startTimeLabel: string; serviceName: string; technicianName: string; status: AppointmentStatus;
}

export interface ServiceOption { serviceId: string; name: string; durationMinutes: number; priceCents: number; }
export interface TechnicianOption { technicianId: string; displayName: string; colorKey: ColorKey; }

// ---- §23 consolidated state ----
export interface BookingState {
  kpis: BookingKpis;
  calendar: BookingCalendarResponse;
  upcomingAppointments: UpcomingAppointment[];
  services: ServiceOption[];
  technicians: TechnicianOption[];
  defaultDate: string;
  defaultView: "day" | "week";
}

// conflict response (§14)
export interface ConflictResult {
  ok: false; reasonCode: "APPOINTMENT_CONFLICT"; message: string; suggestedOpenSlots: CalendarOpenSlot[];
}

// ===== pure helpers (unit-testable) =====

// §14 statuses that block a technician's time
const BLOCKING: AppointmentStatus[] = ["pending_confirmation","confirmed","arrived","checked_in","waiting","assigned","serving"];
export function isBlockingStatus(s: AppointmentStatus): boolean { return BLOCKING.indexOf(s) !== -1; }

// half-open overlap: existing.start < reqEnd && existing.end > reqStart, only for same tech + blocking status
export interface ExistingAppt { technicianId: string; startTime: string; endTime: string; status: AppointmentStatus; }
export function hasConflict(existing: ExistingAppt[], technicianId: string, reqStart: string, reqEnd: string): boolean {
  const s = Date.parse(reqStart), e = Date.parse(reqEnd);
  return existing.some(function (a) {
    if (a.technicianId !== technicianId) return false;
    if (!isBlockingStatus(a.status)) return false;
    return Date.parse(a.startTime) < e && Date.parse(a.endTime) > s;
  });
}

// derive duration when endTime is missing (§13.5): sum of selected service durations
export function computeDurationFromServices(services: { serviceId: string; durationMinutes: number }[], selectedIds: string[]): number {
  return selectedIds.reduce(function (sum, id) {
    const svc = services.find(function (x) { return x.serviceId === id; });
    return sum + (svc ? svc.durationMinutes : 0);
  }, 0);
}

// add minutes to an ISO time, returning ISO (for suggested endTime)
export function addMinutesIso(startIso: string, minutes: number): string {
  return new Date(Date.parse(startIso) + minutes * 60000).toISOString();
}

export function percentOfTotal(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

// ===== §9/§10 additions: POS Booking master state — rows, KPIs, settings, integration, availability, transfers =====
export type PBStatus = "booked" | "confirmed" | "arrived" | "checked_in" | "waiting" | "in_service" | "completed" | "cancelled" | "no_show";   // Decision 38 (+ computed 'late', see pbLateness)
/** Decision 38 — LATE is computed from the salon clock, never stored (see @aipowersalon/api-contracts appointment-status). */
export type PBLateness = "late_within_grace" | "late_beyond_grace";
export type PBDisplayStatus = PBStatus | "late";
export type PBSource = "walk_in" | "phone" | "online" | "google" | "ai" | "customer_app" | "manual";
export type PBDepositStatus = "not_required" | "required" | "paid" | "failed";
export type PBConflictStatus = "none" | "warning" | "conflict";

export interface PBServiceLine {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  priceCents?: Money;
  priceOverrideCents?: Money;
  overrideReason?: string;
  isAddon?: boolean;
  parentServiceId?: string;
}

export interface POSBookingAppointmentRow {
  appointmentId: string; tenantId: string; branchId?: string; customerId?: string; customerName: string; customerPhone?: string; isVip?: boolean;
  customerAvatarUrl?: string | null;
  technicianId?: string; technicianName?: string; services: PBServiceLine[]; source: PBSource; startTime: string; endTime: string; durationMinutes: number;
  /** Smooth Refresh spec §15/§59: optimistic-concurrency version; send it back as expectedVersion on reschedule/update. */
  version?: number;
  /** true when this row was written as an explicit, audited overbook (migration 482 overbook_ok) — merge Oct 12 2026 */
  overbooked?: boolean;
  status: PBStatus; depositStatus?: PBDepositStatus; conflictStatus?: PBConflictStatus; queueKey?: string; techTicketStatus?: string; startSource?: string; notes?: string; createdAt: string; updatedAt: string;
  /** Decision 38: the appointment's date, and — computed on read from the salon's clock — whether the customer is late.
   *  `status` stays the stored status (it decides which actions are allowed); `displayStatus` is what the board shows. */
  date?: string; displayStatus?: PBDisplayStatus; lateMinutes?: number | null; lateness?: PBLateness | null; arrivedAt?: string | null;
}

export interface POSBookingKpisFull {
  totalBookingsToday: number; confirmedBookings: number; checkedInBookings: number; waitingBookings: number; inServiceBookings: number;
  completedBookings: number; cancelledBookings: number; noShowBookings: number; onlineBookings: number; googleBookings: number; aiBookings: number;
  conflictCount: number; depositsCollectedCents: Money;
  /** Decision 38: customers in the salon not yet checked in; booked/confirmed whose start has passed (computed). */
  arrivedBookings?: number; lateBookings?: number;
  /** 200-technician mandate (Oct 23 2026): booked / confirmed starting in the next 60 minutes (today only) — the board's
   *  "Arriving soon" card counted only the appointments it had downloaded */
  arrivingSoonBookings?: number;
  /** booking200 §08 (round 12): status 'booked' only — made, not yet confirmed (confirmedBookings counts booked + confirmed) */
  awaitingConfirmationBookings?: number;
}
/** booking200 §08: the "Arriving soon" window is configurable; the board default stays 60 minutes. */
export const ARRIVING_SOON_DEFAULT_MINUTES = 60;
export const ARRIVING_SOON_MIN_MINUTES = 5;
export const ARRIVING_SOON_MAX_MINUTES = 240;
export function clampArrivingWindow(v: unknown): number {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n <= 0) return ARRIVING_SOON_DEFAULT_MINUTES;
  return Math.min(ARRIVING_SOON_MAX_MINUTES, Math.max(ARRIVING_SOON_MIN_MINUTES, n));
}
/** Booked / confirmed appointments starting within [nowMinute, nowMinute + windowMinutes] on `today` (the branch's day). */
export function pbArrivingSoon(rows: { date: string; startTime: string; status: string }[], today: string, nowMinute: number, windowMinutes: number = ARRIVING_SOON_DEFAULT_MINUTES): number {
  const toMin = (t: string) => { const [h, m] = String(t).split(':').map((x) => parseInt(x, 10)); return h * 60 + (m || 0); };
  const w = clampArrivingWindow(windowMinutes);
  return rows.filter((a) => a.date === today && (a.status === 'booked' || a.status === 'confirmed') && toMin(a.startTime) >= nowMinute && toMin(a.startTime) <= nowMinute + w).length;
}

export type OverbookingPolicy = 'BLOCK' | 'WARN_REQUIRE_CONFIRMATION' | 'ALLOW_AUTHORIZED_ROLE';
export const OVERBOOKING_POLICIES: readonly OverbookingPolicy[] = ['BLOCK', 'WARN_REQUIRE_CONFIRMATION', 'ALLOW_AUTHORIZED_ROLE'];

export interface BookingSettings {
  slotIntervalMinutes: number; bufferMinutes: number; defaultServiceDurationMinutes: number; minimumLeadTimeMinutes: number; maxAdvanceBookingDays: number;
  cancellationWindowHours: number; noShowFeeCents?: Money; depositRequired: boolean; depositPercent?: number; preventDoubleBooking: boolean; allowOverbooking: boolean;
  /** Smooth Refresh spec §11. BLOCK: a conflict is always refused. WARN_REQUIRE_CONFIRMATION: any booker may overbook after
   *  confirming with a reason. ALLOW_AUTHORIZED_ROLE: only holders of booking.override (owner/manager) may, with a reason. */
  overbookingPolicy: OverbookingPolicy;
  openTime: string; closeTime: string; timezone: string;
  /** Decision 32/38: minutes after the start time a late booked customer keeps priority (default 15, tenant-editable). */
  lateGraceMinutes: number;
}
export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  slotIntervalMinutes: 15, bufferMinutes: 5, defaultServiceDurationMinutes: 45, minimumLeadTimeMinutes: 0, maxAdvanceBookingDays: 90,
  cancellationWindowHours: 24, noShowFeeCents: 0, depositRequired: false, depositPercent: 0, preventDoubleBooking: true, allowOverbooking: false,
  overbookingPolicy: 'BLOCK',
  openTime: "09:00", closeTime: "19:00", timezone: "America/New_York",
  lateGraceMinutes: 15,
};

export interface BookingIntegrationStatus {
  onlineBooking: "enabled" | "disabled" | "not_configured";
  googleBooking: "connected" | "pending" | "not_configured";
  aiBooking: "enabled" | "disabled" | "not_configured";
  customerAppBooking: "enabled" | "disabled" | "not_configured";
}
export const DEFAULT_INTEGRATION_STATUS: BookingIntegrationStatus = {
  onlineBooking: "not_configured", googleBooking: "not_configured", aiBooking: "not_configured", customerAppBooking: "not_configured",
};

export interface BookingFilterFacets { statuses: string[]; sources: string[]; technicians: { technicianId: string; name: string }[]; services: { serviceId: string; name: string; priceCents?: Money; durationMinutes?: number }[]; serviceCategories: string[]; branches: { branchId: string; name: string }[]; }

// Booking aggregates over the FULL day set (same basis as KPIs) — derived, not fabricated.
// Revenue + booked minutes exclude cancelled/no_show (they don't represent active booked work).
export interface BookingAggregates {
  walkInsToday: number;
  /** booking200 §08 (round 12): walk-in appointments of the day that still count (not cancelled / no-show) */
  walkInsActive?: number;
  bookedRevenueCents: Money;
  bookedMinutes: number;
  sourceCounts: { source: string; count: number }[];
  serviceCounts: { name: string; count: number }[];
}
export function computeBookingAggregates(rows: { source: string; status?: string; services: { serviceName: string; durationMinutes?: number; priceCents?: number }[] }[]): BookingAggregates {
  let walkInsToday = 0, walkInsActive = 0, bookedRevenueCents = 0, bookedMinutes = 0;
  const src: Record<string, number> = {}, svc: Record<string, number> = {};
  for (const r of rows) {
    const dead = r.status === "cancelled" || r.status === "no_show";
    if (r.source === "walk_in") { walkInsToday++; if (!dead) walkInsActive++; }
    src[r.source] = (src[r.source] || 0) + 1;
    for (const s of r.services || []) svc[s.serviceName] = (svc[s.serviceName] || 0) + 1;
    if (!dead) for (const s of r.services || []) { bookedRevenueCents += s.priceCents || 0; bookedMinutes += s.durationMinutes || 0; }
  }
  return {
    walkInsToday, walkInsActive, bookedRevenueCents, bookedMinutes,
    sourceCounts: Object.entries(src).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    serviceCounts: Object.entries(svc).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

export interface POSBookingFullState {
  kpis: POSBookingKpisFull;
  dateRange: { from: string; to: string; timezone: string };
  bookings: { items: POSBookingAppointmentRow[]; pagination?: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  filters: BookingFilterFacets;
  settings: BookingSettings;
  integrationStatus: BookingIntegrationStatus;
  aggregates?: BookingAggregates;
}

export interface PBServiceLineInput {
  serviceId?: string;
  name?: string;
  durationMinutes?: number;
  priceCents?: number;
  overrideReason?: string;
  isAddon?: boolean;
  parentServiceId?: string;
}

export interface PBCreateRequest {
  technicianId?: string;
  /** Round 2 H: the (server-side, opened) booking session whose live hold this booking is made from — that hold does not
   *  block it and is converted into the appointment. Never a raw client value: callers open a sealed token first. */
  holdSessionId?: string | null;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  serviceIds: string[];
  serviceLines?: PBServiceLineInput[];
  priceOverrides?: Record<string, { priceCents: number; reason?: string }>;
  partySize?: number;
  date: string;
  startTime: string;
  source?: PBSource;
  notes?: string;
  isVip?: boolean;
  managerOverride?: boolean;
}
export interface PBUpdateRequest { customerName?: string; customerPhone?: string; serviceIds?: string[]; notes?: string; isVip?: boolean; expectedVersion?: number; overbookConfirmed?: boolean; overbookReason?: string; managerOverride?: boolean; }
export interface PBRescheduleRequest {
  technicianId?: string; startTime: string; date?: string; managerOverride?: boolean; notifyCustomer?: boolean; reason?: string;
  /** §14–§16/§50: the version the client last saw; a newer server version → VERSION_CONFLICT (409). */
  expectedVersion?: number;
  /** §11: intentional double booking must be confirmed with a reason (and, under ALLOW_AUTHORIZED_ROLE, the role must hold booking.override). */
  overbookConfirmed?: boolean; overbookReason?: string;
  /** Round 3 H2: the (server-side, opened) booking session moving this appointment — its own live hold on the target does
   *  not block the move and is used up by it. Never a raw client value (not in RESCHEDULE_BODY). */
  holdSessionId?: string | null;
}
export interface PBAssignTechnicianRequest { technicianId: string; managerOverride?: boolean; /** §14–§16: stale copy → VERSION_CONFLICT */ expectedVersion?: number; overbookConfirmed?: boolean; overbookReason?: string; reason?: string; }
export interface PBCancelRequest { reason: string; notifyCustomer?: boolean; }
export interface PBNoShowRequest { reason: string; }
export interface PBConflictCheckRequest { technicianId: string; startTime: string; endTime: string; date?: string; appointmentId?: string; }
export interface PBAvailabilityQuery { date?: string; serviceIds?: string[]; technicianId?: string; branchId?: string; /** the visible page's technicians (200-technician mandate §28) */ technicianIds?: string[]; }

// ===== pure helpers (unit-testable) =====
export function pbMinutesOf(t: string): number { const p = t.split(":"); return (+p[0]) * 60 + (+p[1]); }
export function pbAddMinutes(t: string, mins: number): string { const tot = pbMinutesOf(t) + mins; const h = Math.floor(tot / 60), m = tot % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
export function pbDuration(services: { durationMinutes: number }[]): number { return services.reduce((a, s) => a + s.durationMinutes, 0); }
export function pbWithinStoreHours(startTime: string, endTime: string, openTime: string, closeTime: string): boolean { return pbMinutesOf(startTime) >= pbMinutesOf(openTime) && pbMinutesOf(endTime) <= pbMinutesOf(closeTime); }
const PB_BLOCKING: readonly string[] = CHAIR_HOLDING_STATUSES;   // Decision 38: one shared list (an arrived customer holds the chair)
// Thrown by a repository's atomic create when the transactional re-check (under an advisory lock) finds the slot was
// taken by a concurrent booking after the caller's pre-check passed. Lives here (not in a service) so both the
// front-desk booking repo and the customer-booking repo can throw it without importing each other's service.
/** Smooth Refresh spec §25–§27/§91: the Booking board change feed. `cursor` is opaque to the client. `hasMore` (M4):
 *  this sweep has more rows — ask again AT ONCE with `cursor` (a continuation); false → `cursor` is the next tick's. */
export interface BookingChangesResponse { appointments: POSBookingAppointmentRow[]; cursor: string; serverTime: string; hasMore?: boolean }
/** Feed limits: a look-back window covers transactions that COMMIT after rows with a later stamp were read (the board
 *  applies rows idempotently, so re-sending one is harmless); a stale cursor tells the client to reload.
 *  M4 (Oct 24 2026, 200 technicians): a busy minute can change more than one page of rows — the M5 pilot's paced front
 *  desks book ~30 a second, and a 200-chair salon's peak hour stamps ~16 rows a minute plus every phone booking for
 *  later days. The feed used to answer RESYNC_REQUIRED above 50 rows (every desk reloaded its board on every tick of
 *  such a minute). Now a sweep is PAGED: `pageRows` rows a page in (updated_at, id) order up to the sweep's fixed upper
 *  bound, `hasMore` + a continuation cursor; only a sweep longer than `maxPages` pages (> 600 changed rows in ~30 s —
 *  a bulk import, not a front desk) still answers RESYNC_REQUIRED(too_many_changes), where one board reload is cheaper
 *  than the rows. Nothing is ever dropped: a page is exactly the rows, and the alternative is a full reload. */
export const BOOKING_FEED = { lookBackMs: 15_000, maxAgeMs: 30 * 60_000, pageRows: 200, maxPages: 3, /** @deprecated the page size — kept for callers of the old name */ maxRows: 200 } as const;
export class BookingResyncRequired extends Error {
  readonly code = 'RESYNC_REQUIRED' as const;
  constructor(public reason: 'cursor_invalid' | 'cursor_expired' | 'too_many_changes') { super('The schedule changed too much to update in place; reloading it.'); this.name = 'BookingResyncRequired'; }
}
export function encodeBookingCursor(iso: string): string { return 'v1.' + Buffer.from(iso, 'utf8').toString('base64url'); }
/** A continuation inside one sweep: `since` = the sweep's tick cursor, `upto` = its fixed upper bound (the server time of
 *  its first page), `after` = the (updated_at ms, id) of the last row sent, `page` = pages sent so far. */
export interface BookingFeedContinuation { since: number; upto: number; afterMs: number; afterId: string; page: number }
export function encodeBookingContinuation(c: BookingFeedContinuation): string { return 'v2.' + Buffer.from(JSON.stringify([c.since, c.upto, c.afterMs, c.afterId, c.page]), 'utf8').toString('base64url'); }
/** null = no cursor given (first call: returns just a fresh cursor). Throws BookingResyncRequired when unusable. */
export function decodeBookingCursor(cursor: string | undefined, nowMs: number): Date | null {
  if (!cursor) return null;
  if (cursor.startsWith('v2.')) return new Date(decodeBookingContinuation(cursor, nowMs).since);
  if (!cursor.startsWith('v1.')) throw new BookingResyncRequired('cursor_invalid');
  const iso = Buffer.from(cursor.slice(3), 'base64url').toString('utf8');
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t > nowMs + 60_000) throw new BookingResyncRequired('cursor_invalid');
  if (nowMs - t > BOOKING_FEED.maxAgeMs) throw new BookingResyncRequired('cursor_expired');
  return new Date(t);
}
export function decodeBookingContinuation(cursor: string, nowMs: number): BookingFeedContinuation {
  let v: unknown;
  try { v = JSON.parse(Buffer.from(cursor.slice(3), 'base64url').toString('utf8')); } catch { throw new BookingResyncRequired('cursor_invalid'); }
  if (!Array.isArray(v) || v.length !== 5) throw new BookingResyncRequired('cursor_invalid');
  const [since, upto, afterMs, afterId, page] = v as unknown[];
  const nums = [since, upto, afterMs, page].every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!nums || typeof afterId !== 'string' || afterId.length > 64 || (upto as number) > nowMs + 60_000 || (since as number) > (upto as number) || (page as number) < 1) throw new BookingResyncRequired('cursor_invalid');
  if (nowMs - (since as number) > BOOKING_FEED.maxAgeMs) throw new BookingResyncRequired('cursor_expired');
  return { since: since as number, upto: upto as number, afterMs: afterMs as number, afterId, page: page as number };
}

/** §12/§14 stable machine codes carried on the 409 body as `code`. */
export type BookingConflictCode = 'APPOINTMENT_CONFLICT' | 'VERSION_CONFLICT' | 'OVERBOOK_CONFIRMATION_REQUIRED' | 'RESYNC_REQUIRED';
export class BookingVersionConflict extends Error {
  constructor(public currentVersion: number | null) { super('This appointment was changed on another device. The schedule has been refreshed.'); this.name = 'BookingVersionConflict'; }
}
/** Round 3 H2: the locked re-check inside the repository transaction found another session's live hold on the slot. */
export class BookingSlotHeld extends Error {
  constructor(public holdId?: string) { super('That time is being held for another booking'); this.name = 'BookingSlotHeld'; }
}
export class BookingConflictRace extends Error {
  constructor(public conflictingAppointmentId?: string) { super('Technician is double-booked at that time'); this.name = 'BookingConflictRace'; }
}
export function pbDetectTechnicianConflict(
  existing: { appointmentId: string; technicianId?: string; startTime: string; endTime: string; status: PBStatus }[],
  technicianId: string, startTime: string, endTime: string, bufferMinutes: number, ignoreAppointmentId?: string,
): { status: PBConflictStatus; conflictingAppointmentId?: string } {
  const s = pbMinutesOf(startTime) - bufferMinutes, e = pbMinutesOf(endTime) + bufferMinutes;
  for (const a of existing) {
    if (a.appointmentId === ignoreAppointmentId) continue;
    if (a.technicianId !== technicianId) continue;
    if (PB_BLOCKING.indexOf(a.status) === -1) continue;
    if (pbMinutesOf(a.startTime) < e && pbMinutesOf(a.endTime) > s) return { status: "conflict", conflictingAppointmentId: a.appointmentId };
  }
  return { status: "none" };
}
export function pbDetectCustomerOverlap(
  existing: { appointmentId: string; customerId?: string; startTime: string; endTime: string; status: PBStatus }[],
  customerId: string | undefined, startTime: string, endTime: string, ignoreAppointmentId?: string,
): boolean {
  if (!customerId) return false;
  const s = pbMinutesOf(startTime), e = pbMinutesOf(endTime);
  return existing.some((a) => a.appointmentId !== ignoreAppointmentId && a.customerId === customerId && PB_BLOCKING.indexOf(a.status) !== -1 && pbMinutesOf(a.startTime) < e && pbMinutesOf(a.endTime) > s);
}
// compute free slots for a technician on a day given existing appointments + service duration + buffer + store hours
export function pbComputeAvailability(
  openTime: string, closeTime: string, slotInterval: number, durationMinutes: number, bufferMinutes: number,
  existing: { startTime: string; endTime: string; status: PBStatus }[],
): string[] {
  const open = pbMinutesOf(openTime), close = pbMinutesOf(closeTime); const slots: string[] = [];
  for (let t = open; t + durationMinutes <= close; t += slotInterval) {
    const s = t - bufferMinutes, e = t + durationMinutes + bufferMinutes;
    const clash = existing.some((a) => PB_BLOCKING.indexOf(a.status) !== -1 && pbMinutesOf(a.startTime) < e && pbMinutesOf(a.endTime) > s);
    if (!clash) { const h = Math.floor(t / 60), m = t % 60; slots.push((h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m); }
  }
  return slots;
}
export function pbCanCheckIn(status: PBStatus): boolean { return isCheckInEligible(status); }   // booked, confirmed, arrived
/** Decision 38: the customer is in the salon but not yet checked in. Only from booked/confirmed (a late customer is still
 *  booked/confirmed underneath — LATE is computed — so a late customer can be marked arrived). */
export function pbCanMarkArrived(status: PBStatus): boolean { return isAwaitingArrival(status); }
/** Decision 38 — LATE, from the salon's wall clock: a booked/confirmed appointment whose start has passed. Earlier days
 *  still awaiting arrival are beyond grace (minutes unknown → null). Never late once arrived or later, and never for a
 *  future date. Within `graceMinutes` the customer keeps priority (Decision 32); after it staff decide — nothing is
 *  cancelled automatically. */
export function pbLateness(date: string | undefined, startTime: string, status: PBStatus, today: string, nowMinuteOfDay: number, graceMinutes: number): { lateMinutes: number | null; lateness: PBLateness | null } {
  if (!date || !isAwaitingArrival(status)) return { lateMinutes: null, lateness: null };
  if (date > today) return { lateMinutes: null, lateness: null };
  if (date < today) return { lateMinutes: null, lateness: "late_beyond_grace" };
  const late = nowMinuteOfDay - pbMinutesOf(startTime);
  if (!(late > 0)) return { lateMinutes: null, lateness: null };
  return { lateMinutes: late, lateness: late <= Math.max(0, graceMinutes) ? "late_within_grace" : "late_beyond_grace" };
}
/** Adds date-derived lateness to a board row (both repositories call this, so the in-memory and real paths agree). */
export function pbWithLateness<T extends { date?: string; startTime: string; status: PBStatus }>(row: T, today: string, nowMinuteOfDay: number, graceMinutes: number): T & { displayStatus: PBDisplayStatus; lateMinutes: number | null; lateness: PBLateness | null } {
  const l = pbLateness(row.date, row.startTime, row.status, today, nowMinuteOfDay, graceMinutes);
  return { ...row, ...l, displayStatus: l.lateness ? "late" : row.status };
}
export function pbCanConfirm(status: PBStatus): boolean { return status === "booked"; }
export function pbCanStartService(status: PBStatus): { ok: boolean; reason?: string } {
  if (status === "in_service") return { ok: false, reason: "ALREADY_IN_SERVICE" };
  if (["cancelled", "no_show", "completed"].includes(status)) return { ok: false, reason: "NOT_ACTIVE" };
  return { ok: true };
}
export function pbQueueKey(id: string): string { return id + ":move_to_queue"; }
export function pbTechQueueKey(id: string): string { return id + ":move_to_tech_queue"; }
export function pbServingKey(id: string): string { return id + ":start_service"; }
export function pbSearch(rows: POSBookingAppointmentRow[], q: string): POSBookingAppointmentRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || (r.technicianName || "").toLowerCase().includes(s) || r.services.some((x) => x.serviceName.toLowerCase().includes(s)) || (r.notes || "").toLowerCase().includes(s) || r.appointmentId.toLowerCase().includes(s));
}

// ---- schedule-aware availability (booking calendar upgrade, 2026-07-03) ----------------------------------------
// The original pbComputeAvailability only knew the STORE's open/close. These helpers intersect that with the
// technician's own weekly schedule (technician_schedules: day start/end + lunch, is_working) and subtract that
// date's technician_blocked_times, producing the tech's true bookable WINDOWS for the day. Everything is pure
// minutes-of-day arithmetic so it is unit-tested without a database; the repository feeds it real rows.

export interface PBMinuteRange { start: number; end: number }
export interface PBTechDaySchedule {
  /** null → no schedule row for that weekday: the tech follows plain store hours (legacy behavior preserved). */
  isWorking: boolean | null;
  shifts?: { startTime: string; endTime: string }[] | null;
  breaks?: { startTime: string; endTime: string; type: 'lunch'|'paid'|'unpaid' }[] | null;
  startTime?: string | null; endTime?: string | null;
  lunchStartTime?: string | null; lunchEndTime?: string | null;
}

function clampRange(r: PBMinuteRange, lo: number, hi: number): PBMinuteRange | null {
  const s = Math.max(r.start, lo), e = Math.min(r.end, hi);
  return e > s ? { start: s, end: e } : null;
}
function subtractRange(ranges: PBMinuteRange[], cut: PBMinuteRange): PBMinuteRange[] {
  const out: PBMinuteRange[] = [];
  for (const r of ranges) {
    if (cut.end <= r.start || cut.start >= r.end) { out.push(r); continue; }
    if (cut.start > r.start) out.push({ start: r.start, end: Math.min(cut.start, r.end) });
    if (cut.end < r.end) out.push({ start: Math.max(cut.end, r.start), end: r.end });
  }
  return out.filter((r) => r.end > r.start);
}

/** Mandate §51 (Oct 20 2026): an APPROVED time-off range (timestamptz) clipped to one salon day → the HH:MM block
 *  the schedule engine already understands. Pure. `dayStartMs`/`dayEndMs` are the salon-zone bounds of `date`;
 *  a range that touches the day at all yields a block; one wholly outside yields null. Whole-day → 00:00–23:59. */
export function pbTimeOffToBlock(off: { startsAtMs: number; endsAtMs: number; reason?: string | null }, dayStartMs: number, dayEndMs: number, tz: string): { startTime: string; endTime: string; reason: string } | null {
  if (!(off.endsAtMs > dayStartMs) || !(off.startsAtMs < dayEndMs)) return null;
  const hhmm = (ms: number) => { const p = zonedParts(new Date(ms), tz); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
  const startTime = off.startsAtMs <= dayStartMs ? '00:00' : hhmm(off.startsAtMs);
  const endTime = off.endsAtMs >= dayEndMs ? '23:59' : hhmm(off.endsAtMs);
  return { startTime, endTime, reason: 'time_off' + (off.reason ? ': ' + String(off.reason) : '') };
}

/** Store hours ∩ tech schedule − lunch − blocked times → the technician's bookable windows (minutes of day). */
export function pbTechDayWindows(
  openTime: string, closeTime: string,
  sched: PBTechDaySchedule | null,
  blocked: { startTime: string; endTime: string }[],
): PBMinuteRange[] {
  const open = pbMinutesOf(openTime), close = pbMinutesOf(closeTime);
  if (close <= open) return [];
  if (sched && sched.isWorking === false) return [];                       // explicitly off that weekday
  let windows: PBMinuteRange[] = [{ start: open, end: close }];
  
  if (sched && sched.isWorking === true) {
    if (sched.shifts && sched.shifts.length > 0) {
      windows = sched.shifts.map(s => clampRange({ start: pbMinutesOf(s.startTime), end: pbMinutesOf(s.endTime) }, open, close)).filter((w): w is PBMinuteRange => w !== null);
    } else if (sched.startTime && sched.endTime) {
      const w = clampRange({ start: pbMinutesOf(sched.startTime), end: pbMinutesOf(sched.endTime) }, open, close);
      windows = w ? [w] : [];
    }
  }
  
  if (sched?.breaks && sched.breaks.length > 0) {
    for (const b of sched.breaks) windows = subtractRange(windows, { start: pbMinutesOf(b.startTime), end: pbMinutesOf(b.endTime) });
  } else if (sched?.lunchStartTime && sched?.lunchEndTime) {
    windows = subtractRange(windows, { start: pbMinutesOf(sched.lunchStartTime), end: pbMinutesOf(sched.lunchEndTime) });
  }
  
  for (const b of blocked) windows = subtractRange(windows, { start: pbMinutesOf(b.startTime), end: pbMinutesOf(b.endTime) });
  return windows;
}

/** Slot starts (HH:MM) inside the given windows — the schedule-aware sibling of pbComputeAvailability. */
export function pbComputeAvailabilityInWindows(
  windows: PBMinuteRange[], slotInterval: number, durationMinutes: number, bufferMinutes: number,
  existing: { startTime: string; endTime: string; status: PBStatus }[],
): string[] {
  const slots: string[] = [];
  for (const w of windows) {
    const first = Math.ceil(w.start / slotInterval) * slotInterval;        // align to the visual grid
    for (let t = first; t + durationMinutes <= w.end; t += slotInterval) {
      const s = t - bufferMinutes, e = t + durationMinutes + bufferMinutes;
      const clash = existing.some((a) => PB_BLOCKING.indexOf(a.status) !== -1 && pbMinutesOf(a.startTime) < e && pbMinutesOf(a.endTime) > s);
      if (!clash) { const h = Math.floor(t / 60), m = t % 60; slots.push((h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m); }
    }
  }
  return slots;
}

/** Contiguous FREE ranges (windows minus buffered busy appointments) with their gap length in minutes.
 *  `notBeforeMinute` (spec §6): for the CURRENT day, minutes already in the past are not open — pass the
 *  current minute-of-day (snapped up by the caller) and ranges are clamped/dropped accordingly. Omit (or pass
 *  null) for other dates. */
export function pbOpenRanges(
  windows: PBMinuteRange[], bufferMinutes: number,
  existing: { startTime: string; endTime: string; status: PBStatus }[],
  notBeforeMinute?: number | null,
): { start: number; end: number; minutes: number }[] {
  let free = windows.slice();
  for (const a of existing) {
    if (PB_BLOCKING.indexOf(a.status) === -1) continue;
    free = subtractRange(free, { start: pbMinutesOf(a.startTime) - bufferMinutes, end: pbMinutesOf(a.endTime) + bufferMinutes });
  }
  if (notBeforeMinute != null && notBeforeMinute > 0) {
    free = free
      .map((r) => ({ start: Math.max(r.start, notBeforeMinute), end: r.end }))
      .filter((r) => r.end > r.start);
  }
  return free.map((r) => ({ start: r.start, end: r.end, minutes: r.end - r.start }));
}

/** True when [startTime,endTime) sits fully inside one of the technician's windows. */
export function pbWithinTechWindows(startTime: string, endTime: string, windows: PBMinuteRange[]): boolean {
  const s = pbMinutesOf(startTime), e = pbMinutesOf(endTime);
  return windows.some((w) => s >= w.start && e <= w.end);
}
