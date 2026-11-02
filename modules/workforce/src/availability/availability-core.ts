// availability-core.ts — PURE "can this technician take a [instant, instant + duration) window?" answer for the
// eligibility engine's AvailabilityPort (merge Oct 12 2026: the other chat's live-technician-schedule/availability-core.ts,
// Technician Profile mandate §20–§21). No I/O: the caller loads the facts (weekly schedule, approved time off, blocked
// times, live breaks, branch) and hands them in.
//
// Checks, in order (first failure wins):
//   BRANCH_MISMATCH — the technician works at another branch than the one requested;
//   TIME_OFF        — an APPROVED time-off row (528/582 vocabulary: 'approved') overlaps the window (branch-specific rows
//                     only apply to that branch);
//   NO_SCHEDULE / OFF_DAY / OUTSIDE_SHIFT — the weekly schedule for that salon-local weekday (multi-shift aware);
//   LUNCH / SCHEDULED_BREAK — the window overlaps the day's lunch or a scheduled break;
//   BLOCKED         — a technician_blocked_times row for that date overlaps;
//   ON_BREAK        — a LIVE break (technician_breaks, open) overlaps the window start.
import { businessDate, zonedParts } from '@aipowersalon/date-time';
import type { TechDaySchedule } from '../technicians/technicians.dto';

export type UnavailableReason = 'BRANCH_MISMATCH' | 'TIME_OFF' | 'NO_SCHEDULE' | 'OFF_DAY' | 'OUTSIDE_SHIFT' | 'LUNCH' | 'SCHEDULED_BREAK' | 'BLOCKED' | 'ON_BREAK';

export interface ScheduleFacts {
  /** IANA timezone the schedule is expressed in (salon-local). */
  timezone: string;
  /** Weekly hours keyed by day name ('monday'…) — the shape TechniciansRepository.getSchedule returns. */
  weekly: Record<string, TechDaySchedule | undefined>;
  /** Time-off rows; only status 'approved' removes availability. branchId null = every branch. */
  timeOff?: { startsAt: string; endsAt: string; status: string; branchId?: string | null }[];
  /** technician_blocked_times for the relevant date(s): 'YYYY-MM-DD' + 'HH:MM'. */
  blockedTimes?: { date: string; startTime: string; endTime: string }[];
  /** Live breaks (technician_breaks, 580); an open one has endedAt null. */
  liveBreaks?: { startedAt: string; endedAt: string | null }[];
  /** The technician's branch (null/undefined = any). */
  branchId?: string | null;
  /** The branch the booking is for (null/undefined = don't check). */
  requestedBranchId?: string | null;
}

export interface AvailabilityResult { available: boolean; reason?: UnavailableReason; detail?: string }

export const DAY_NAMES_LOCAL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function hhmmToMin(v: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

/** Day-of-week (0 = Sunday) for a 'YYYY-MM-DD' string, no timezone involved. */
export function dowOfDate(date: string): number {
  const [y, m, d] = date.split('-').map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;
const localMinutes = (d: Date, tz: string) => { const p = zonedParts(d, tz); return p.hour * 60 + p.minute; };

/** The working windows (minutes) of a day schedule: explicit `shifts` when present, else start..end. */
export function workingWindows(day: TechDaySchedule | undefined): { s: number; e: number }[] {
  if (!day || !day.isWorking) return [];
  const src = Array.isArray(day.shifts) && day.shifts.length ? day.shifts : [{ startTime: day.startTime, endTime: day.endTime }];
  return src.map((w) => ({ s: hhmmToMin(w.startTime), e: hhmmToMin(w.endTime) })).filter((w): w is { s: number; e: number } => w.s != null && w.e != null && w.e > w.s);
}

export function isTechnicianAvailableAt(facts: ScheduleFacts, instant: Date | string | number, durationMin: number): AvailabilityResult {
  const start = new Date(instant);
  if (!isFinite(start.getTime())) return { available: false, reason: 'OUTSIDE_SHIFT', detail: 'invalid instant' };
  const dur = Math.max(1, Math.floor(Number(durationMin) || 0));
  const end = new Date(start.getTime() + dur * 60_000);
  const tz = facts.timezone || 'America/New_York';

  if (facts.requestedBranchId && facts.branchId && facts.requestedBranchId !== facts.branchId) return { available: false, reason: 'BRANCH_MISMATCH' };

  for (const t of facts.timeOff || []) {
    if (String(t.status).toLowerCase() !== 'approved') continue;
    if (t.branchId && facts.requestedBranchId && t.branchId !== facts.requestedBranchId) continue;
    if (overlaps(start.getTime(), end.getTime(), new Date(t.startsAt).getTime(), new Date(t.endsAt).getTime())) return { available: false, reason: 'TIME_OFF' };
  }

  const date = businessDate(tz, start);
  const sMin = localMinutes(start, tz);
  const endDate = businessDate(tz, end);
  const eMin = endDate === date ? localMinutes(end, tz) : 24 * 60 + localMinutes(end, tz);   // crosses local midnight
  const dayName = DAY_NAMES_LOCAL[dowOfDate(date)];
  if (!Object.keys(facts.weekly || {}).length) return { available: false, reason: 'NO_SCHEDULE' };
  const day = facts.weekly[dayName];
  if (!day || !day.isWorking) return { available: false, reason: 'OFF_DAY' };
  if (!workingWindows(day).some((w) => sMin >= w.s && eMin <= w.e)) return { available: false, reason: 'OUTSIDE_SHIFT' };

  const ls = hhmmToMin(day.lunchStart), le = hhmmToMin(day.lunchEnd);
  if (ls != null && le != null && le > ls && overlaps(sMin, eMin, ls, le)) return { available: false, reason: 'LUNCH' };
  for (const b of day.breaks || []) {
    const bs = hhmmToMin(b.startTime), be = hhmmToMin(b.endTime);
    if (bs != null && be != null && be > bs && overlaps(sMin, eMin, bs, be)) return { available: false, reason: b.type === 'lunch' ? 'LUNCH' : 'SCHEDULED_BREAK' };
  }

  for (const b of facts.blockedTimes || []) {
    if (b.date !== date) continue;
    const bs = hhmmToMin(b.startTime), be = hhmmToMin(b.endTime);
    if (bs != null && be != null && overlaps(sMin, eMin, bs, be)) return { available: false, reason: 'BLOCKED' };
  }

  for (const b of facts.liveBreaks || []) {
    const bs = new Date(b.startedAt).getTime();
    const be = b.endedAt ? new Date(b.endedAt).getTime() : Number.POSITIVE_INFINITY;
    if (start.getTime() >= bs && start.getTime() < be) return { available: false, reason: 'ON_BREAK' };
  }

  return { available: true };
}
