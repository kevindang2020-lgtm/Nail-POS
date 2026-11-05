/**
 * compensation-scheduled-hours.ts — derive a technician's SCHEDULED hours/days for a payroll period from the
 * scheduling data that has existed since migration 003: the weekly template (technician_schedules — day_of_week
 * 0=Sunday..6=Saturday, TIME start/end, optional lunch window, is_working) minus per-date blocked windows
 * (technician_blocked_times, migration 035). Pure — no I/O; the autobuild adapter feeds it rows.
 *
 * Honesty rules:
 *  - Returns null when the template has no working rows — the caller then OMITS scheduledHours, and the guarantee
 *    engine's no-scheduled-data fail-safe (Jul 28, 2026) pays the full guarantee with a note. Never fabricate.
 *  - A day's scheduled minutes never go negative; a block can zero a day (which then doesn't count as a scheduled
 *    day) but never produces negative hours.
 *  - Multiple template rows for the same weekday (multi-branch schedules on a tenant-wide period) SUM — the salon
 *    scheduled that person for both windows.
 */

export interface WeeklyTemplateRow {
  dayOfWeek: number;               // 0=Sunday .. 6=Saturday (matches technicians repo DAY_NAMES + JS getUTCDay)
  startTime: string | null;        // 'HH:MM' or 'HH:MM:SS'
  endTime: string | null;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  isWorking: boolean;
}

export interface BlockedWindow { date: string; startTime: string; endTime: string; }  // date 'YYYY-MM-DD', times 'HH:MM'

export interface ScheduledPeriod { scheduledHours: number; scheduledDays: number; }

const MAX_PERIOD_DAYS = 400; // safety cap — a payroll period is never this long

function minutesOf(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t).trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes one template row schedules: (end − start) − lunch, floored at 0. Overnight (end ≤ start) → 0, not negative. */
function rowMinutes(r: WeeklyTemplateRow): number {
  const s = minutesOf(r.startTime); const e = minutesOf(r.endTime);
  if (s == null || e == null || e <= s) return 0;
  let mins = e - s;
  const ls = minutesOf(r.lunchStart); const le = minutesOf(r.lunchEnd);
  if (ls != null && le != null && le > ls) mins -= Math.min(mins, le - ls);
  return mins;
}

export function computeScheduledHours(
  template: WeeklyTemplateRow[], blocks: BlockedWindow[], fromDate: string, toDate: string,
): ScheduledPeriod | null {
  const working = (template || []).filter((r) => r.isWorking && rowMinutes(r) > 0);
  if (!working.length) return null;                          // no template → caller omits; engine fail-safe applies

  const perDow = new Map<number, number>();                  // weekday → scheduled minutes (rows for the same day SUM)
  for (const r of working) {
    const d = Number(r.dayOfWeek) % 7;
    perDow.set(d, (perDow.get(d) ?? 0) + rowMinutes(r));
  }

  const blockedByDate = new Map<string, number>();           // date → blocked minutes (windows on the same date SUM)
  for (const b of blocks || []) {
    const s = minutesOf(b.startTime); const e = minutesOf(b.endTime);
    if (s == null || e == null || e <= s) continue;
    const key = String(b.date).slice(0, 10);
    blockedByDate.set(key, (blockedByDate.get(key) ?? 0) + (e - s));
  }

  const start = new Date(`${String(fromDate).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(toDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;

  let totalMinutes = 0; let days = 0;
  for (let i = 0, d = new Date(start); d <= end && i < MAX_PERIOD_DAYS; i++, d = new Date(d.getTime() + 86400000)) {
    const base = perDow.get(d.getUTCDay()) ?? 0;
    if (base <= 0) continue;
    const key = d.toISOString().slice(0, 10);
    const mins = Math.max(0, base - (blockedByDate.get(key) ?? 0));
    if (mins > 0) { totalMinutes += mins; days += 1; }
  }
  if (days === 0) return null;                               // fully blocked / template never lands in period → fail-safe
  return { scheduledHours: totalMinutes / 60, scheduledDays: days };
}
