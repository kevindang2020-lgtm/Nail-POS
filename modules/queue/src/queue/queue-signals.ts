// queue-signals.ts — pure technician signals for the assignment engine (BUILD_PLAN Phase 6, audit bugs 1 and 4).
// The engine's rotation / fairness / timing rules had nothing to read: availableInMinutes was hard-coded null, the
// workload count saw a 20-row page, every technician was given the caller's branch. These functions turn the rows the
// repository reads (technician_statuses, technician_schedules, technician_shifts, technician_blocked_times,
// pos_tech_appointments, the active queue) into the signals the contract names. Times of day are the BRANCH's
// ('HH:MM' + minutes since the branch's midnight); instants are epoch ms. null = truly unknown, never a guess.

export const FINISHED_QUEUE_STATUSES = ['completed', 'done', 'cancelled', 'removed'] as const;
const FINISHED = new Set<string>(FINISHED_QUEUE_STATUSES);
export const isActiveQueueStatus = (s: string): boolean => !FINISHED.has(s);

export function hhmmToMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v));
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}

export interface TechSignalInput {
  technicianId: string;
  liveStatus: string | null;                         // latest technician_statuses.status (null = none recorded)
  schedule: { start: string; end: string; lunchStart?: string | null; lunchEnd?: string | null; isWorking: boolean } | null;
  punch: { startMs: number | null; endMs: number | null; status: string | null } | null;   // today's technician_shifts row
  blocks: { start: string; end: string }[];          // today's technician_blocked_times
  appointments: { start: string; status: string }[]; // today's pos_tech_appointments for this technician
  inService: { startedAtMs: number; durationMinutes: number }[];   // services running now (queue + tech-queue)
  rosterActive: boolean;                             // technicians.status = 'active' (the roster's own on-duty flag)
}
export interface TechSignals {
  onBreak: boolean; blocked: boolean;
  /** REAL clock state (merge Oct 12 2026): true = an open punch, false = she punched today and clocked out, null = this
   *  salon has no punch for her (does not use the clock) — the AI engine then keeps deriving it from `available`. */
  clockedIn: boolean | null;
  shiftEndsInMinutes: number | null; availableInMinutes: number | null; nextAppointmentInMinutes: number | null;
  status: 'available' | 'in_service' | 'on_break' | 'blocked' | 'off_shift';
}

const UPCOMING_APPT = new Set(['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'scheduled', 'pending']);

/** nowMinutes = minutes since the branch's midnight; nowMs = the same instant. */
export function computeTechSignals(t: TechSignalInput, nowMinutes: number, nowMs: number): TechSignals {
  const sched = t.schedule && t.schedule.isWorking ? t.schedule : null;
  const lunchS = hhmmToMinutes(sched?.lunchStart), lunchE = hhmmToMinutes(sched?.lunchEnd);
  const inLunch = lunchS != null && lunchE != null && nowMinutes >= lunchS && nowMinutes < lunchE;
  const onBreak = t.liveStatus === 'on_break' || inLunch;

  let blockEnd: number | null = null;
  for (const b of t.blocks) {
    const s = hhmmToMinutes(b.start), e = hhmmToMinutes(b.end);
    if (s != null && e != null && nowMinutes >= s && nowMinutes < e) blockEnd = Math.max(blockEnd ?? 0, e);
  }
  const blocked = blockEnd != null;

  const punchedIn = !!t.punch && t.punch.startMs != null && t.punch.endMs == null && t.punch.status !== 'cancelled' && t.punch.status !== 'canceled';
  const schedEnd = hhmmToMinutes(sched?.end);
  let shiftEndsInMinutes: number | null = null;
  if (schedEnd != null) shiftEndsInMinutes = Math.max(0, schedEnd - nowMinutes);
  else if (t.punch && t.punch.endMs != null && t.punch.endMs > nowMs) shiftEndsInMinutes = Math.round((t.punch.endMs - nowMs) / 60000);
  // a technician who clocked out (punch ended, nothing scheduled) has no shift left
  if (t.punch && t.punch.endMs != null && t.punch.endMs <= nowMs && schedEnd == null) shiftEndsInMinutes = 0;

  let next: number | null = null;
  for (const a of t.appointments) {
    if (!UPCOMING_APPT.has(a.status)) continue;
    const s = hhmmToMinutes(a.start); if (s == null || s < nowMinutes) continue;
    const d = s - nowMinutes; if (next == null || d < next) next = d;
  }

  const serviceLeft = t.inService.length
    ? Math.max(...t.inService.map((s) => Math.max(0, Math.ceil((s.startedAtMs + s.durationMinutes * 60000 - nowMs) / 60000))))
    : null;
  const schedStart = hhmmToMinutes(sched?.start);
  const offByStatus = t.liveStatus === 'off_today' || t.liveStatus === 'off_shift' || t.liveStatus === 'off';
  const beforeShift = schedStart != null && nowMinutes < schedStart;
  const afterShift = schedEnd != null && nowMinutes >= schedEnd;
  const offShift = !punchedIn && (offByStatus || beforeShift || afterShift || (!sched && t.liveStatus == null && !t.rosterActive));

  let availableInMinutes: number | null;
  if (blocked) availableInMinutes = Math.max(0, (blockEnd as number) - nowMinutes);
  else if (onBreak) availableInMinutes = inLunch ? Math.max(0, (lunchE as number) - nowMinutes) : null;   // a manual break has no known end
  else if (serviceLeft != null) availableInMinutes = serviceLeft;
  else if (offShift) availableInMinutes = beforeShift ? (schedStart as number) - nowMinutes : null;   // gone for the day = unknown, not "now"
  else availableInMinutes = 0;

  const status: TechSignals['status'] = blocked ? 'blocked' : onBreak ? 'on_break' : serviceLeft != null ? 'in_service' : offShift ? 'off_shift' : 'available';
  const clockedIn = punchedIn ? true : (t.punch && t.punch.endMs != null && t.punch.endMs <= nowMs ? false : null);
  return { onBreak, blocked, clockedIn, shiftEndsInMinutes, availableInMinutes, nextAppointmentInMinutes: next, status };
}

/**
 * Rotation order: index 0 = next up. A configured fixed order wins (technicians not in it follow, by last served);
 * otherwise the technician served longest ago (never served today first). Ties break by name so the order is stable.
 */
export function rotationOrder(techs: { technicianId: string; name: string; lastServedAtMs: number | null }[], fixedOrder: string[]): Record<string, number> {
  const fixed = fixedOrder.filter((id) => techs.some((t) => t.technicianId === id));
  const rest = techs.filter((t) => !fixed.includes(t.technicianId))
    .sort((a, b) => (a.lastServedAtMs ?? -Infinity) - (b.lastServedAtMs ?? -Infinity) || a.name.localeCompare(b.name));
  const out: Record<string, number> = {};
  [...fixed, ...rest.map((t) => t.technicianId)].forEach((id, i) => { out[id] = i; });
  return out;
}

/** Minutes of work already on a technician: queued guests' full durations + what is left of services running now. */
export function assignedMinutesFor(entries: { status: string; durationMinutes: number; startedAtMs: number | null }[], nowMs: number): number {
  let total = 0;
  for (const e of entries) {
    if (!isActiveQueueStatus(e.status)) continue;
    if (e.status === 'in_service' && e.startedAtMs != null) total += Math.max(0, Math.ceil((e.startedAtMs + e.durationMinutes * 60000 - nowMs) / 60000));
    else total += Math.max(0, e.durationMinutes);
  }
  return total;
}

/** Appointment lateness at check-in, in whole minutes (0 = on time, null = not an appointment / unknown start). */
export function lateMinutesAt(checkedInAtMs: number, appointmentStartMs: number | null): number | null {
  if (appointmentStartMs == null) return null;
  return Math.max(0, Math.floor((checkedInAtMs - appointmentStartMs) / 60000));
}
