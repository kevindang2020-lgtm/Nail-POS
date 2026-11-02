// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { LiveScheduleFilters } from '@aipowersalon/api-contracts/tenant';
import type { LiveScheduleFilters } from '@aipowersalon/api-contracts/tenant';
// live-technician-schedule.dto.ts — types + PURE helpers for the Live Technician Schedule.
// This is an AGGREGATION view: it does NOT own appointments (those live in pos_tech_appointments, shared with
// tech-appointments / booking), nor shifts (technician_schedules), nor live status (technician_statuses). It composes
// them into one real-time board. The helpers below are pure (no I/O) so they unit-test without a DB and are reused by
// both the in-memory and Postgres adapters.

export type LiveTechStatus =
  | 'available' | 'assigned' | 'checked_in_waiting' | 'in_service' | 'service_done'
  | 'on_break' | 'lunch' | 'off_shift' | 'blocked' | 'offline';

export type LiveApptStatus =
  | 'confirmed' | 'arrived' | 'checked_in' | 'assigned' | 'in_service' | 'completed' | 'no_show' | 'cancelled';

export type LiveApptSource =
  | 'pos' | 'customer_app' | 'online_booking' | 'google_booking' | 'ai_booking' | 'phone_ai' | 'walk_in' | 'phone' | 'manual' | 'online' | 'google' | 'ai';

export const LIVE_STATUS_LABEL: Record<LiveTechStatus, string> = {
  available: 'Available', assigned: 'Assigned', checked_in_waiting: 'Waiting', in_service: 'In Service',
  service_done: 'Service Done', on_break: 'On Break', lunch: 'Lunch', off_shift: 'Off Shift', blocked: 'Blocked', offline: 'Offline',
};

export interface LiveShift { startTime: string; endTime: string; breakStartTime?: string; breakEndTime?: string; }

export interface LiveScheduleAppointment {
  appointmentId: string; customerId?: string; customerName: string; customerInitials: string; avatarUrl?: string | null; customerAvatarUrl?: string | null;
  serviceSummary: string; startTime: string; endTime: string; status: LiveApptStatus; source: LiveApptSource; ticketId?: string;
}
export interface LiveScheduleOpenSlot {
  slotId: string; technicianId: string; startTime: string; endTime: string; durationMinutes: number;
  reason: 'schedule_open' | 'cancellation' | 'manual_gap' | 'ai_suggestion';
}
export interface LiveScheduleBlock { blockId: string; startTime: string; endTime: string; reason: string; note?: string; }
export interface LiveScheduleActiveTicket { ticketId: string; serviceSummary: string; customerName: string; startedAt?: string; }

export interface LiveTechnicianColumn {
  technicianId: string; userId?: string; fullName: string; initials: string; avatarUrl?: string | null; roleLabel: string;
  status: LiveTechStatus; shift?: LiveShift; skills: string[];
  appointments: LiveScheduleAppointment[]; openSlots: LiveScheduleOpenSlot[]; blocks: LiveScheduleBlock[];
  activeTicket?: LiveScheduleActiveTicket; bookedHours: number; utilizationPercent: number;
}

export interface LiveTechnicianScheduleKpis {
  workingToday: number; availableNow: number; inService: number; onBreakOrLunch: number; bookedHours: number; utilizationPercent: number;
}
export interface LiveTechnicianScheduleState {
  date: string; branchId: string; timeRange: { startTime: string; endTime: string; slotMinutes: number }; technicians: LiveTechnicianColumn[];
  /** present when the request paged the columns (lanePage) — `technicians` is that page only */
  lanes?: import('@aipowersalon/api-contracts/tenant').LiveScheduleLanePage;
}
export interface LiveTechnicianDetail {
  technicianId: string; userId?: string; fullName: string; initials: string; avatarUrl?: string | null; roleLabel: string; phone?: string;
  status: LiveTechStatus; shift?: LiveShift; skills: string[]; appointments: LiveScheduleAppointment[]; openSlots: LiveScheduleOpenSlot[];
  blocks: LiveScheduleBlock[]; activeTicket?: LiveScheduleActiveTicket; nextAppointment?: LiveScheduleAppointment;
  bookedHours: number; utilizationPercent: number; salesTodayCents: number | null; tipsTodayCents: number | null; commissionPreviewCents: number | null;
}
export interface LiveTechnicianSchedulePageState {
  context: { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] };
  kpis: LiveTechnicianScheduleKpis;
  schedule: LiveTechnicianScheduleState;
  filters: { statuses: { label: string; value: string }[]; skills: { label: string; value: string }[]; technicians: { label: string; value: string }[] };
  selectedTechnician?: LiveTechnicianDetail;
}

export interface BlockTechnicianTimeRequest { date?: string; startTime: string; endTime: string; reason?: string; note?: string; }
export interface BreakRequest { reason?: string; managerOverride?: boolean; }

// ----------------------------- pure time helpers -----------------------------
export function lsMinutesOf(t: string): number { const [h, m] = (t || '0:0').split(':').map((x) => parseInt(x, 10) || 0); return h * 60 + m; }
export function lsToHHMM(total: number): string { const t = Math.max(0, total); const h = Math.floor(t / 60), m = t % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
export function lsInitials(name: string): string { const p = (name || '').trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '?'; }
export function lsDayOfWeek(dateIso: string): number { const d = new Date((dateIso || '1970-01-01') + 'T00:00:00Z'); return d.getUTCDay(); } // 0=Sun

const BUSY_APPT: LiveApptStatus[] = ['confirmed', 'arrived', 'checked_in', 'assigned', 'in_service', 'completed'];
export function lsApptIsBusy(s: LiveApptStatus): boolean { return BUSY_APPT.indexOf(s) >= 0; }

// minutes of booked (busy, non-cancelled/no-show) appointment time
export function lsBookedMinutes(appts: { startTime: string; endTime: string; status: LiveApptStatus }[]): number {
  return appts.filter((a) => lsApptIsBusy(a.status)).reduce((acc, a) => acc + Math.max(0, lsMinutesOf(a.endTime) - lsMinutesOf(a.startTime)), 0);
}
export function lsShiftMinutes(shift?: LiveShift): number {
  if (!shift) return 0;
  let total = Math.max(0, lsMinutesOf(shift.endTime) - lsMinutesOf(shift.startTime));
  if (shift.breakStartTime && shift.breakEndTime) total -= Math.max(0, lsMinutesOf(shift.breakEndTime) - lsMinutesOf(shift.breakStartTime));
  return Math.max(0, total);
}
export function lsUtilization(bookedMin: number, shiftMin: number): number {
  if (shiftMin <= 0) return 0; return Math.max(0, Math.min(100, Math.round((bookedMin / shiftMin) * 100)));
}

// Open slots = gaps inside the shift (minus lunch) not covered by any busy block (appointments + blocked times),
// each at least `slotMin` long. Returns chronological slots.
export function lsComputeOpenSlots(
  technicianId: string, shift: LiveShift | undefined,
  busy: { startTime: string; endTime: string }[], slotMin: number,
): LiveScheduleOpenSlot[] {
  if (!shift) return [];
  const open = lsMinutesOf(shift.startTime), close = lsMinutesOf(shift.endTime);
  const blocks: { s: number; e: number }[] = busy.map((b) => ({ s: lsMinutesOf(b.startTime), e: lsMinutesOf(b.endTime) }));
  if (shift.breakStartTime && shift.breakEndTime) blocks.push({ s: lsMinutesOf(shift.breakStartTime), e: lsMinutesOf(shift.breakEndTime) });
  blocks.sort((a, b) => a.s - b.s);
  const slots: LiveScheduleOpenSlot[] = []; let cursor = open;
  for (const b of blocks) {
    if (b.e <= cursor || b.s >= close) continue;
    if (b.s > cursor && b.s - cursor >= slotMin) slots.push({ slotId: technicianId + ':' + cursor, technicianId, startTime: lsToHHMM(cursor), endTime: lsToHHMM(b.s), durationMinutes: b.s - cursor, reason: 'schedule_open' });
    cursor = Math.max(cursor, b.e);
  }
  if (close - cursor >= slotMin) slots.push({ slotId: technicianId + ':' + cursor, technicianId, startTime: lsToHHMM(cursor), endTime: lsToHHMM(close), durationMinutes: close - cursor, reason: 'schedule_open' });
  return slots;
}

// Normalize the displayed status. The live technician_statuses value wins for break/lunch/off/offline; otherwise the
// status is derived from the shift (no shift today → off_shift) and the appointments (an active in_service appt →
// in_service; a checked-in appt → waiting; an upcoming assigned appt → assigned; else available). A blocked window
// covering `nowMinutes` shows `blocked`.
export function lsNormalizeStatus(
  rawStatus: string | undefined, hasShiftToday: boolean,
  appts: { startTime: string; endTime: string; status: LiveApptStatus }[],
  blocks: { startTime: string; endTime: string }[], nowMinutes: number,
): LiveTechStatus {
  const raw = (rawStatus || '').toLowerCase();
  if (raw === 'inactive' || raw === 'offline') return 'offline';
  if (raw === 'on_break') return 'on_break';
  if (raw === 'lunch') return 'lunch';
  if (raw === 'off_shift' || raw === 'clocked_out') return 'off_shift';
  if (raw === 'available' || raw === 'clocked_in') {
    // Merge Oct 12 2026: a presence flag without any shift today (no schedule AND no open punch) is stale — Off Shift.
    // (The Kysely adapter gives an OPEN punch a shift, so a clocked-in technician is never hidden.)
    if (!hasShiftToday) return 'off_shift';
    if (blocks.some((b) => lsMinutesOf(b.startTime) <= nowMinutes && lsMinutesOf(b.endTime) > nowMinutes)) return 'blocked';
    if (appts.some((a) => a.status === 'in_service')) return 'in_service';
    if (appts.some((a) => a.status === 'checked_in' || a.status === 'arrived')) return 'checked_in_waiting';
    const upcoming = appts.filter((a) => (a.status === 'assigned' || a.status === 'confirmed') && lsMinutesOf(a.endTime) > nowMinutes);
    if (upcoming.length) return 'assigned';
    if (appts.some((a) => a.status === 'completed') && !upcoming.length) return 'service_done';
    return 'available';
  }
  if (!hasShiftToday) return 'off_shift';
  if (blocks.some((b) => lsMinutesOf(b.startTime) <= nowMinutes && lsMinutesOf(b.endTime) > nowMinutes)) return 'blocked';
  if (raw === 'in_service' || appts.some((a) => a.status === 'in_service')) return 'in_service';
  if (appts.some((a) => a.status === 'checked_in' || a.status === 'arrived')) return 'checked_in_waiting';
  const upcoming = appts.filter((a) => (a.status === 'assigned' || a.status === 'confirmed') && lsMinutesOf(a.endTime) > nowMinutes);
  if (upcoming.length) return 'assigned';
  if (appts.some((a) => a.status === 'completed') && !upcoming.length) return 'service_done';
  return 'available';
}

// Roll the per-technician columns up into the KPI row. "now" is in minutes; a technician counts as working today if a
// shift exists and the status is not off_shift/offline.
export function lsRollupKpis(cols: LiveTechnicianColumn[]): LiveTechnicianScheduleKpis {
  const working = cols.filter((c) => !!c.shift && c.status !== 'off_shift' && c.status !== 'offline');
  const bookedMin = cols.reduce((a, c) => a + lsBookedMinutes(c.appointments), 0);
  const shiftMin = working.reduce((a, c) => a + lsShiftMinutes(c.shift), 0);
  return {
    workingToday: working.length,
    availableNow: cols.filter((c) => c.status === 'available').length,
    inService: cols.filter((c) => c.status === 'in_service').length,
    onBreakOrLunch: cols.filter((c) => c.status === 'on_break' || c.status === 'lunch').length,
    bookedHours: Math.round((bookedMin / 60) * 10) / 10,
    utilizationPercent: lsUtilization(bookedMin, shiftMin),
  };
}

// Map a pos_tech_appointments status string to the live appointment status (they already align; this is defensive).
export function lsMapApptStatus(s: string): LiveApptStatus {
  const v = (s || '').toLowerCase();
  const allowed: LiveApptStatus[] = ['confirmed', 'arrived', 'checked_in', 'assigned', 'in_service', 'completed', 'no_show', 'cancelled'];
  if (allowed.indexOf(v as LiveApptStatus) >= 0) return v as LiveApptStatus;
  if (v === 'booked') return 'confirmed';
  if (v === 'waiting') return 'checked_in';
  return 'confirmed';
}
