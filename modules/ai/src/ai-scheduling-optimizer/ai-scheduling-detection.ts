// ai-scheduling-detection.ts — PURE detectors over the time core. Three families: schedule gaps, booking conflicts
// (overbooking/double-booking), and understaffing. Key rules: an approved BREAK is never reported as an unused gap (breaks
// are subtracted out of the free space first); conflicts carry a severity and the affected appointment ids; understaffing
// honestly returns 'data_insufficient' rather than inventing a number when there isn't enough signal.
import { Range, subtractRanges, durationOf, overlaps, contains } from './ai-scheduling-core';

// ── schedule gaps ─────────────────────────────────────────────────────────────
export type GapCause = 'before_first' | 'after_last' | 'between_appointments' | 'too_small_for_service' | 'large_unused';
export interface ScheduleGap {
  range: Range; durationMin: number; cause: GapCause;
  servicesThatFit: string[]; minServiceFits: boolean; confidence: number;
}
export interface GapService { serviceId: string; durationMin: number; }

/** Free windows in a shift after removing appointments AND breaks, classified by cause. Breaks are never gaps. */
export function detectGaps(shift: Range, appointments: Range[], breaks: Range[], opts: { services?: GapService[]; minServiceMin?: number; largeBlockMin?: number } = {}): ScheduleGap[] {
  const minService = opts.minServiceMin ?? 15;
  const largeBlock = opts.largeBlockMin ?? 120;
  const services = opts.services ?? [];
  const busy = [...appointments, ...breaks];                                   // breaks removed → never surfaced as gaps
  const free = subtractRanges(shift, busy).filter((g) => durationOf(g) > 0);
  const apptStart = appointments.length ? Math.min(...appointments.map((a) => a.start)) : null;
  const apptEnd = appointments.length ? Math.max(...appointments.map((a) => a.end)) : null;

  return free.map((g) => {
    const dur = durationOf(g);
    let cause: GapCause;
    if (dur < minService) cause = 'too_small_for_service';
    else if (dur >= largeBlock) cause = 'large_unused';
    else if (apptStart != null && g.end <= apptStart) cause = 'before_first';
    else if (apptEnd != null && g.start >= apptEnd) cause = 'after_last';
    else cause = 'between_appointments';
    const servicesThatFit = services.filter((s) => s.durationMin <= dur).map((s) => s.serviceId);
    return { range: g, durationMin: dur, cause, servicesThatFit, minServiceFits: dur >= minService, confidence: dur >= minService ? 0.9 : 0.6 };
  });
}

// ── conflicts / overbooking ───────────────────────────────────────────────────
export type ConflictType = 'DOUBLE_BOOK' | 'BEYOND_SHIFT' | 'OUTSIDE_HOURS' | 'STATION_OVERBOOK';
export type Severity = 'high' | 'medium' | 'low';
export interface ApptRec { id: string; technicianId: string; range: Range; stationId?: string | null; }
export interface Conflict { type: ConflictType; severity: Severity; appointmentIds: string[]; message: string; }

export function detectConflicts(appointments: ApptRec[], ctx: { shiftsByTech?: Record<string, Range[]>; branchHours?: Range | null; stationCapacity?: Record<string, number> }): Conflict[] {
  const conflicts: Conflict[] = [];
  // double-booking: same technician, overlapping ranges
  for (let i = 0; i < appointments.length; i++) {
    for (let j = i + 1; j < appointments.length; j++) {
      const a = appointments[i], b = appointments[j];
      if (a.technicianId === b.technicianId && overlaps(a.range, b.range)) conflicts.push({ type: 'DOUBLE_BOOK', severity: 'high', appointmentIds: [a.id, b.id], message: 'technician double-booked' });
    }
  }
  for (const a of appointments) {
    // beyond shift
    const shifts = ctx.shiftsByTech?.[a.technicianId];
    if (shifts && shifts.length && !shifts.some((s) => contains(s, a.range))) conflicts.push({ type: 'BEYOND_SHIFT', severity: 'medium', appointmentIds: [a.id], message: 'appointment outside technician shift' });
    // outside branch hours
    if (ctx.branchHours && !contains(ctx.branchHours, a.range)) conflicts.push({ type: 'OUTSIDE_HOURS', severity: 'medium', appointmentIds: [a.id], message: 'appointment outside branch hours' });
  }
  // station overbooking: concurrent occupancy beyond capacity
  if (ctx.stationCapacity) {
    for (const [stationId, cap] of Object.entries(ctx.stationCapacity)) {
      const atStation = appointments.filter((a) => a.stationId === stationId);
      for (const a of atStation) {
        const concurrent = atStation.filter((b) => overlaps(a.range, b.range) || b.id === a.id).length;
        if (concurrent > cap) { conflicts.push({ type: 'STATION_OVERBOOK', severity: 'medium', appointmentIds: atStation.filter((b) => overlaps(a.range, b.range) || b.id === a.id).map((b) => b.id), message: `station ${stationId} over capacity` }); break; }
      }
    }
  }
  return conflicts;
}

// ── understaffing ─────────────────────────────────────────────────────────────
export type StaffingState = 'adequately_staffed' | 'slightly_understaffed' | 'understaffed' | 'severely_understaffed' | 'data_insufficient';
export interface StaffingResult { state: StaffingState; demandMinutes: number; capacityMinutes: number; missingMinutes: number; missingSkills: string[]; confidence: number; }

/** Compare demand (confirmed + forecast) to available qualified capacity. Honest data_insufficient when signal is thin. */
export function detectUnderstaffing(input: { confirmedDemandMin: number; forecastDemandMin?: number | null; capacityMin: number; requiredSkills?: string[]; availableSkills?: string[]; sampleSize?: number; forecastAvailable?: boolean }): StaffingResult {
  const demand = input.confirmedDemandMin + (input.forecastDemandMin ?? 0);
  const capacity = input.capacityMin;
  const missingSkills = (input.requiredSkills ?? []).filter((s) => !(input.availableSkills ?? []).includes(s));

  // not enough signal to judge (no capacity data, or no demand signal at all)
  if (capacity <= 0 && demand <= 0) return { state: 'data_insufficient', demandMinutes: demand, capacityMinutes: capacity, missingMinutes: 0, missingSkills, confidence: 0.2 };
  if ((input.sampleSize ?? 1) < 1) return { state: 'data_insufficient', demandMinutes: demand, capacityMinutes: capacity, missingMinutes: Math.max(0, demand - capacity), missingSkills, confidence: 0.2 };

  const missing = Math.max(0, demand - capacity);
  const ratio = capacity > 0 ? demand / capacity : Infinity;
  let state: StaffingState;
  if (ratio <= 0.9) state = 'adequately_staffed';
  else if (ratio <= 1.05) state = 'slightly_understaffed';
  else if (ratio <= 1.3) state = 'understaffed';
  else state = 'severely_understaffed';
  if (missingSkills.length && state === 'adequately_staffed') state = 'slightly_understaffed';   // missing a required skill still matters
  // forecast unavailable → lower confidence (never invent busy-hour data)
  const confidence = input.forecastAvailable === false ? 0.5 : 0.85;
  return { state, demandMinutes: demand, capacityMinutes: capacity, missingMinutes: missing, missingSkills, confidence };
}
