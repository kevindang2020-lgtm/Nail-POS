import type { Money } from '@aipowersalon/money';
export type { Money };   // owned by @aipowersalon/money (Constitution 13 §86)
import { centsToUsd } from '@aipowersalon/money';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { TechApptFilters } from '@aipowersalon/api-contracts/tenant';
import type { TechApptFilters } from '@aipowersalon/api-contracts/tenant';
import { CHAIR_HOLDING_STATUSES, isCheckInEligible } from '@aipowersalon/api-contracts';
export { centsToUsd };   // owned by @aipowersalon/money (Constitution 13 §86)
// tech-appointments.dto.ts — AIPowerSalon POS Tech Appointments (`GET /pos/tech-appointments`).
// Technician scheduling board: KPIs, day/week calendar by technician, selected-appointment detail,
// open-time suggestions, waitlist/standby, quick actions. Context resolved from session — never client-sent.

export type ApptStatus = "confirmed" | "checked_in" | "serving" | "completed" | "no_show" | "cancelled" | "rescheduled";
export type ColorKey = "pink" | "purple" | "blue" | "orange" | "green";

export interface CountKpi { count: number; change: number; changePercent?: number; comparisonLabel: string; }

export interface TechApptCard {
  appointmentId: string; customerId: string; customerName: string; serviceNames: string[];
  startTime: string; endTime: string; status: ApptStatus; isVip?: boolean; source: "appointment" | "walk_in";
}
export interface TechApptColumn {
  technicianId: string; name: string; role: string; colorKey: ColorKey; online: boolean;
  appointments: TechApptCard[]; openSlots: { startTime: string; endTime: string }[];
}
export interface SelectedAppointment {
  appointmentId: string; customerId: string; customerName: string; customerPhone: string;
  isVip?: boolean; loyaltyLabel?: string; date: string; startTime: string; endTime: string;
  technicianId: string; technicianName: string; technicianRole: string; status: ApptStatus;
  services: { name: string; priceCents: Money }[]; estTotalCents: Money; notes?: string;
}
export interface OpenSuggestion { technicianId: string; technicianName: string; startTime: string; label: string; serviceName: string; }
export interface WaitlistEntry { customerId: string; customerName: string; serviceName: string; etaLabel: string; position: number; }

export interface TechAppointmentsResponse {
  context: { tenantId: string; branchId: string; salonName: string; branchName: string; businessDate: string; timezone: string; };
  kpis: {
    todaysAppointments: CountKpi; openSlots: CountKpi; reschedules: CountKpi;
    checkedInGuests: CountKpi; noShows: CountKpi;
    techUtilization: { percent: number; change: number };
  };
  view: "day" | "week";
  columns: TechApptColumn[];
  selectedAppointment: SelectedAppointment | null;
  openSuggestions: OpenSuggestion[];
  waitlist: WaitlistEntry[];
}

// statuses that occupy a technician slot (block conflicting bookings) — §10 conflict rule
export const BLOCKING_STATUSES: ApptStatus[] = ["confirmed", "checked_in", "serving", "rescheduled"];

// ===== pure helpers (unit-testable) =====

export function changePercent(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
export function estTotalCents(services: { priceCents: Money }[]): Money {
  return services.reduce(function (a, s) { return a + s.priceCents; }, 0);
}
// tech utilization = booked minutes / available minutes, rounded to whole percent
export function utilizationPercent(bookedMinutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0) return 0;
  return Math.round((bookedMinutes / availableMinutes) * 100);
}
function toMin(t: string): number { const p = t.split(":"); return (+p[0]) * 60 + (+p[1]); }
// §10 conflict: same technician, overlapping window, blocking status
export function hasConflict(
  existing: { technicianId: string; startTime: string; endTime: string; status: ApptStatus }[],
  technicianId: string, startTime: string, endTime: string
): boolean {
  const s = toMin(startTime), e = toMin(endTime);
  return existing.some(function (a) {
    if (a.technicianId !== technicianId) return false;
    if (BLOCKING_STATUSES.indexOf(a.status) === -1) return false;
    return toMin(a.startTime) < e && toMin(a.endTime) > s;
  });
}
// derive open gaps between sorted appointments within a shift window (minutes >= minGap)
export function openSlotsFor(
  shiftStart: string, shiftEnd: string,
  appts: { startTime: string; endTime: string }[], minGapMinutes: number
): { startTime: string; endTime: string }[] {
  const fmt = function (m: number) { const h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm; };
  const sorted = appts.slice().sort(function (a, b) { return toMin(a.startTime) - toMin(b.startTime); });
  const out: { startTime: string; endTime: string }[] = [];
  let cursor = toMin(shiftStart); const end = toMin(shiftEnd);
  sorted.forEach(function (a) { const s = toMin(a.startTime); if (s - cursor >= minGapMinutes) out.push({ startTime: fmt(cursor), endTime: fmt(s) }); cursor = Math.max(cursor, toMin(a.endTime)); });
  if (end - cursor >= minGapMinutes) out.push({ startTime: fmt(cursor), endTime: fmt(end) });
  return out;
}

// ===== §11/§12 additions: 25-technician board — rich items, technicians, KPIs, settings, conflict, transfers =====
export type TAStatus = "booked" | "confirmed" | "arrived" | "checked_in" | "waiting" | "in_service" | "completed" | "cancelled" | "no_show";   // Decision 38
export type TASource = "walk_in" | "phone" | "online" | "google" | "ai" | "customer_app" | "manual";
export type TADepositStatus = "not_required" | "required" | "paid" | "failed";
export type TAConflictStatus = "none" | "warning" | "conflict";
export type TAWorkingStatus = "available" | "in_service" | "on_break" | "off_today" | "scheduled_later";

export interface TAService { serviceId: string; serviceName: string; durationMinutes: number; priceCents?: Money; }

export interface POSTechAppointmentTechnician {
  technicianId: string; displayName: string; firstName?: string; avatarUrl?: string | null; workingStatus: TAWorkingStatus;
  appointmentCount: number; scheduledMinutes: number; availableMinutes: number; serviceSkillGroups: string[];
}

export interface POSTechAppointmentItem {
  appointmentId: string; tenantId: string; branchId?: string; technicianId: string; customerId?: string; customerName: string; avatarUrl?: string | null; customerAvatarUrl?: string | null; customerPhone?: string; isVip?: boolean;
  source: TASource; services: TAService[]; startTime: string; endTime: string; durationMinutes: number; status: TAStatus;
  depositStatus?: TADepositStatus; conflictStatus?: TAConflictStatus; notes?: string;
  /** Smooth Refresh §15/§59: optimistic-concurrency version (482/483) — send back as expectedVersion on edit/move/assign */ version?: number;
  /** true when this row was written as an explicit, audited overbook (482) */ overbooked?: boolean;
  /** BUILD_PLAN Phase 6 (audit bug 2): the appointment's day and its start as an INSTANT — appt_date + 'HH:MM' read on
   *  the BRANCH's wall clock. startTime alone is a time of day; parsing it as a date gave NaN. */
  date?: string; startAt?: string | null;
}

export interface POSTechApptKpisFull {
  totalAppointmentsToday: number; bookedAppointments: number; checkedInAppointments: number; inServiceAppointments: number;
  completedAppointments: number; cancelledAppointments: number; noShowAppointments: number;
  onlineBookings: number; aiBookings: number; googleBookings: number; conflictCount: number;
}

export interface TechApptSettings {
  slotIntervalMinutes: number; openTime: string; closeTime: string; bufferMinutes: number;
  preventDoubleBooking: boolean; allowOverbooking: boolean; requireDeposit: boolean; timezone: string;
}
export const DEFAULT_TA_SETTINGS: TechApptSettings = {
  slotIntervalMinutes: 15, openTime: "09:00", closeTime: "19:00", bufferMinutes: 5,
  preventDoubleBooking: true, allowOverbooking: false, requireDeposit: false, timezone: "America/New_York",
};

export interface TechApptFilterFacets { statuses: string[]; sources: string[]; serviceCategories: string[]; technicians: { technicianId: string; name: string }[]; branches: { branchId: string; name: string }[]; }

export interface POSTechAppointmentsFullState {
  kpis: POSTechApptKpisFull; date: string;
  technicians: POSTechAppointmentTechnician[];
  appointments: POSTechAppointmentItem[];
  filters: TechApptFilterFacets;
  settings: TechApptSettings;
}

// request bodies
export interface CreateAppointmentRequest { technicianId: string; customerId?: string; customerName: string; customerPhone?: string; serviceIds: string[]; date: string; startTime: string; source?: TASource; notes?: string; isVip?: boolean; managerOverride?: boolean; }
export interface UpdateAppointmentRequest { customerName?: string; customerPhone?: string; serviceIds?: string[]; notes?: string; isVip?: boolean; expectedVersion?: number; }
export interface RescheduleRequest { technicianId?: string; startTime: string; date?: string; managerOverride?: boolean; /** §14–§16: the version the client last saw → VERSION_CONFLICT on a stale copy */ expectedVersion?: number; }
export interface AssignTechnicianRequest { technicianId: string; managerOverride?: boolean; expectedVersion?: number; }
export interface CancelAppointmentRequest { reason: string; }
export interface ConflictCheckRequest { technicianId: string; startTime: string; endTime: string; appointmentId?: string; }

// ===== pure helpers (unit-testable) =====
export function minutesOf(t: string): number { const p = t.split(":"); return (+p[0]) * 60 + (+p[1]); }
export function addMinutesToTime(t: string, mins: number): string { const total = minutesOf(t) + mins; const h = Math.floor(total / 60), m = total % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
export function durationOfServices(services: { durationMinutes: number }[]): number { return services.reduce((a, s) => a + s.durationMinutes, 0); }
export function withinStoreHours(startTime: string, endTime: string, openTime: string, closeTime: string): boolean { return minutesOf(startTime) >= minutesOf(openTime) && minutesOf(endTime) <= minutesOf(closeTime); }
const TA_BLOCKING: readonly string[] = CHAIR_HOLDING_STATUSES;   // Decision 38: the one shared list
// returns the conflict status for a candidate slot vs existing appointments (same technician overlap incl. buffer)
export function detectTechnicianConflict(
  existing: { appointmentId: string; technicianId: string; startTime: string; endTime: string; status: TAStatus }[],
  technicianId: string, startTime: string, endTime: string, bufferMinutes: number, ignoreAppointmentId?: string,
): { status: TAConflictStatus; conflictingAppointmentId?: string } {
  const s = minutesOf(startTime) - bufferMinutes, e = minutesOf(endTime) + bufferMinutes;
  for (const a of existing) {
    if (a.appointmentId === ignoreAppointmentId) continue;
    if (a.technicianId !== technicianId) continue;
    if (TA_BLOCKING.indexOf(a.status) === -1) continue;
    if (minutesOf(a.startTime) < e && minutesOf(a.endTime) > s) return { status: "conflict", conflictingAppointmentId: a.appointmentId };
  }
  return { status: "none" };
}
// same customer double-booked at an overlapping time (any technician)
export function detectCustomerOverlap(
  existing: { appointmentId: string; customerId?: string; startTime: string; endTime: string; status: TAStatus }[],
  customerId: string | undefined, startTime: string, endTime: string, ignoreAppointmentId?: string,
): boolean {
  if (!customerId) return false;
  const s = minutesOf(startTime), e = minutesOf(endTime);
  return existing.some((a) => a.appointmentId !== ignoreAppointmentId && a.customerId === customerId && TA_BLOCKING.indexOf(a.status) !== -1 && minutesOf(a.startTime) < e && minutesOf(a.endTime) > s);
}
export function canCheckIn(status: TAStatus): boolean { return isCheckInEligible(status); }   // booked, confirmed, arrived
export function canStartService(status: TAStatus): { ok: boolean; reason?: string } {
  if (status === "in_service") return { ok: false, reason: "ALREADY_IN_SERVICE" };
  if (["cancelled", "no_show", "completed"].includes(status)) return { ok: false, reason: "NOT_ACTIVE" };
  return { ok: true };
}
export function buildQueueIdempotencyKey(appointmentId: string): string { return appointmentId + ":move_to_queue"; }
export function buildTechQueueIdempotencyKey(appointmentId: string): string { return appointmentId + ":move_to_tech_queue"; }
export function buildServingIdempotencyKey(appointmentId: string): string { return appointmentId + ":start_service"; }
export function techApptSearch(rows: POSTechAppointmentItem[], q: string): POSTechAppointmentItem[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter((r) => r.customerName.toLowerCase().includes(s) || (r.customerPhone || "").toLowerCase().includes(s) || r.services.some((x) => x.serviceName.toLowerCase().includes(s)) || (r.notes || "").toLowerCase().includes(s) || r.appointmentId.toLowerCase().includes(s));
}
