/**
 * Availability engine (spec §11–§13, §23).
 *
 * Everything here is pure and operates in minutes-since-local-midnight for the
 * selected date. The same functions back the Daily Availability Strip,
 * View All, Find an Opening, Best Matches and the mock backend's validation —
 * one authoritative definition of "open" (spec §12).
 */
import {
  GRID_MINUTES,
  OCCUPYING_STATUSES,
  type Appointment,
  type AvailabilityGap,
  type BranchHours,
  type ID,
  type ISODate,
  type ScheduleSegment,
  type Technician,
} from './scheduleTypes';
import { ceilToGrid, floorToGrid, hhmmToMinutes, minuteOfDay, toISO } from './time';

export interface Interval {
  start: number;
  end: number;
}

export type BusyKind = 'appointment' | 'lunch' | 'break' | 'blocked' | 'time_off' | 'protection';

export interface BusyInterval extends Interval {
  kind: BusyKind;
  refId: ID;
  /** For appointments: whether it is protected (spec §23). */
  protected?: boolean;
}

export interface TechnicianDayContext {
  technicianId: ID;
  date: ISODate;
  timezone: string;
  /** Working windows ∩ branch hours, sorted, non-overlapping. */
  working: Interval[];
  /** Everything that occupies time, sorted by start. */
  busy: BusyInterval[];
  /** Start minutes of protected commitments (incl. buffer), sorted. */
  protectedStarts: { at: number; refId: ID }[];
}

export interface BuildDayContextInput {
  technician: Technician;
  date: ISODate;
  timezone: string;
  branchHours: BranchHours;
  appointments: Appointment[];
  segments: ScheduleSegment[];
  /** Appointment ids to ignore (e.g. the appointment being moved). */
  ignoreAppointmentIds?: ReadonlySet<ID>;
}

const DAY_END = 24 * 60;

function clip(i: Interval): Interval | null {
  const start = Math.max(0, i.start);
  const end = Math.min(DAY_END, i.end);
  return end > start ? { start, end } : null;
}

export function mergeIntervals<T extends Interval>(list: T[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

function intersect(a: Interval[], b: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of a) {
    const s = Math.max(i.start, b.start);
    const e = Math.min(i.end, b.end);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

export function buildDayContext(input: BuildDayContextInput): TechnicianDayContext {
  const { technician, date, timezone, branchHours, appointments, segments } = input;
  const ignore = input.ignoreAppointmentIds ?? new Set<ID>();
  const toMin = (iso: string) => minuteOfDay(iso, date, timezone);

  const branchWindow: Interval = {
    start: hhmmToMinutes(branchHours.openAt),
    end: hhmmToMinutes(branchHours.closeAt),
  };

  const mine = segments.filter((s) => s.technicianId === technician.id);
  const workingRaw = mine
    .filter((s) => s.type === 'working')
    .map((s) => clip({ start: toMin(s.startAt), end: toMin(s.endAt) }))
    .filter((x): x is Interval => x !== null);

  const working = technician.active && technician.workingState !== 'time_off' && technician.workingState !== 'off'
    ? intersect(mergeIntervals(workingRaw), branchWindow)
    : [];

  const busy: BusyInterval[] = [];
  for (const s of mine) {
    if (s.type === 'working') continue;
    const c = clip({ start: toMin(s.startAt), end: toMin(s.endAt) });
    if (c) busy.push({ ...c, kind: s.type, refId: s.id });
  }
  const protectedStarts: { at: number; refId: ID }[] = [];
  for (const a of appointments) {
    if (a.technicianId !== technician.id) continue;
    if (ignore.has(a.id)) continue;
    if (!OCCUPYING_STATUSES.has(a.status)) continue;
    const c = clip({ start: toMin(a.startAt), end: toMin(a.endAt) });
    if (!c) continue;
    busy.push({ ...c, kind: 'appointment', refId: a.id, protected: a.protected });
    if (a.protected) {
      const buffer = a.protectionBufferMinutes ?? 0;
      protectedStarts.push({ at: c.start - buffer, refId: a.id });
      if (buffer > 0) busy.push({ start: c.start - buffer, end: c.start, kind: 'protection', refId: a.id });
    }
  }
  busy.sort((a, b) => a.start - b.start);
  protectedStarts.sort((a, b) => a.at - b.at);

  return { technicianId: technician.id, date, timezone, working, busy, protectedStarts };
}

/** Free intervals (working minus busy), snapped inward to the grid. */
export function computeGaps(ctx: TechnicianDayContext, grid = GRID_MINUTES): Interval[] {
  const busyMerged = mergeIntervals(ctx.busy);
  const gaps: Interval[] = [];
  for (const w of ctx.working) {
    let cursor = w.start;
    for (const b of busyMerged) {
      if (b.end <= cursor) continue;
      if (b.start >= w.end) break;
      if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, w.end) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < w.end) gaps.push({ start: cursor, end: w.end });
  }
  return gaps
    .map((g) => ({ start: ceilToGrid(g.start, grid), end: floorToGrid(g.end, grid) }))
    .filter((g) => g.end - g.start >= grid);
}

export function gapsToAvailability(ctx: TechnicianDayContext, gaps: Interval[]): AvailabilityGap[] {
  return gaps.map((g) => ({
    technicianId: ctx.technicianId,
    startAt: toISO(ctx.date, g.start, ctx.timezone),
    endAt: toISO(ctx.date, g.end, ctx.timezone),
    durationMinutes: g.end - g.start,
    bookable: true,
  }));
}

export function computeAvailability(input: BuildDayContextInput): AvailabilityGap[] {
  const ctx = buildDayContext(input);
  return gapsToAvailability(ctx, computeGaps(ctx));
}

export type FitFailure =
  | 'OFF_GRID'
  | 'NOT_WORKING'
  | 'OVERLAP'
  | 'LUNCH'
  | 'BREAK'
  | 'BLOCKED'
  | 'TIME_OFF'
  | 'PROTECTED';

export interface FitResult {
  fits: boolean;
  failure?: FitFailure;
  conflictId?: ID;
}

/**
 * Does a booking of `duration` minutes starting at `start` fit entirely
 * (spec §13: based on the whole duration, not just the first cell)?
 */
export function slotFits(
  ctx: TechnicianDayContext,
  start: number,
  duration: number,
  grid = GRID_MINUTES,
): FitResult {
  if (start % grid !== 0 || duration <= 0 || duration % grid !== 0) return { fits: false, failure: 'OFF_GRID' };
  const end = start + duration;
  if (!ctx.working.some((w) => start >= w.start && end <= w.end)) return { fits: false, failure: 'NOT_WORKING' };

  // Appointment protection (spec §23): proposed_start + duration <= next protected commitment.
  const nextProtected = ctx.protectedStarts.find((p) => p.at >= start);
  if (nextProtected && end > nextProtected.at) {
    return { fits: false, failure: 'PROTECTED', conflictId: nextProtected.refId };
  }

  for (const b of ctx.busy) {
    if (b.start >= end) break;
    if (b.end <= start) continue;
    const failure: FitFailure =
      b.kind === 'appointment' ? 'OVERLAP'
      : b.kind === 'lunch' ? 'LUNCH'
      : b.kind === 'break' ? 'BREAK'
      : b.kind === 'blocked' ? 'BLOCKED'
      : b.kind === 'time_off' ? 'TIME_OFF'
      : 'PROTECTED';
    return { fits: false, failure, conflictId: b.refId };
  }
  return { fits: true };
}

/** Largest contiguous bookable run starting exactly at `start`. */
export function availableDurationAt(ctx: TechnicianDayContext, start: number, grid = GRID_MINUTES): number {
  const gap = computeGaps(ctx, grid).find((g) => start >= g.start && start < g.end);
  if (!gap) return 0;
  const nextProtected = ctx.protectedStarts.find((p) => p.at >= start);
  const hardEnd = nextProtected ? Math.min(gap.end, nextProtected.at) : gap.end;
  return Math.max(0, floorToGrid(hardEnd - start, grid));
}

/** All grid starts within `window` where `duration` fits. */
export function enumerateStarts(
  ctx: TechnicianDayContext,
  duration: number,
  window: Interval = { start: 0, end: DAY_END },
  grid = GRID_MINUTES,
): number[] {
  const out: number[] = [];
  for (const w of ctx.working) {
    const from = ceilToGrid(Math.max(w.start, window.start), grid);
    const to = Math.min(w.end, window.end);
    for (let s = from; s + duration <= to; s += grid) {
      if (slotFits(ctx, s, duration, grid).fits) out.push(s);
    }
  }
  return out;
}

export function totalMinutes(list: Interval[]): number {
  return list.reduce((n, i) => n + (i.end - i.start), 0);
}

/** Working minutes, booked minutes (appointments only) and open minutes. */
export function daySummary(ctx: TechnicianDayContext): { workingMinutes: number; bookedMinutes: number; openMinutes: number } {
  const workingMinutes = totalMinutes(ctx.working);
  const bookedMinutes = totalMinutes(
    mergeIntervals(ctx.busy.filter((b) => b.kind === 'appointment')).flatMap((b) => intersect(ctx.working, b)),
  );
  const openMinutes = totalMinutes(computeGaps(ctx));
  return { workingMinutes, bookedMinutes, openMinutes };
}

/** Required duration for a set of services + time-changing add-ons (spec §13). */
export function requiredDuration(items: { durationMinutes: number; addOns?: { durationMinutes: number }[] }[]): number {
  return items.reduce(
    (n, it) => n + it.durationMinutes + (it.addOns ?? []).reduce((m, a) => m + a.durationMinutes, 0),
    0,
  );
}
