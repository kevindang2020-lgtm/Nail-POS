// preferred-staff.ts — TM-04 (Four-Module Completion Guide §9.1, 30 Oct 2026): the PURE check behind "Find Qualified &
// Available Staff" with an optional preferred technician. One technician's day facts (read by preferred-staff.repository.ts
// with the booking engine's own schedule rules: weekly template › one-date override via effectiveDaySchedule, breaks / lunch,
// blocked times and APPROVED time off, chair-holding appointments) → the checks for one window [start, start + duration).
// Never books, never holds, never reorders a queue: it explains. The booking engine stays the final authority — the screen
// cross-checks every start against /pos/booking/availability, and Booking re-checks on save.
import { pbTechDayWindows, pbMinutesOf, type PBTechDaySchedule } from '@aipowersalon/booking';

export type CheckKey = 'active' | 'branch' | 'qualified' | 'shift' | 'breaks' | 'time_off' | 'blocked' | 'appointments' | 'duration' | 'past';
export interface Check { key: CheckKey; ok: boolean; detail?: Record<string, unknown> }
export interface DayFacts {
  technicianId: string; name: string; active: boolean; inBranch: boolean;
  missingServices: string[];                       // requested services this technician has no approved mapping for
  schedule: PBTechDaySchedule | null | undefined;  // effective day (override applied); null/undefined → no weekly row
  scheduleSource: 'override' | 'override_off' | 'weekly_off_rule' | 'weekly' | 'none';   // weekly_off_rule: G3 repeating weekly day off
  blocks: { startTime: string; endTime: string; reason: string }[];   // blocked times + approved time off (as blocks)
  appointments: { id: string; startTime: string; endTime: string; status: string }[];   // chair-holding only
}
export interface Verdict { technicianId: string; name: string; valid: boolean; start: string | null; end: string | null; checks: Check[]; reasons: CheckKey[] }

const ALL_DAY = ['00:00', '23:59'] as const;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** the technician's working windows for the day WITHOUT breaks (shift) and WITH breaks (bookable), minutes of day */
export function windowsOf(s: PBTechDaySchedule | null | undefined) {
  const withBreaks = pbTechDayWindows(ALL_DAY[0], ALL_DAY[1], s ?? null, []);
  const noBreaks = pbTechDayWindows(ALL_DAY[0], ALL_DAY[1], s ? { ...s, breaks: null, lunchStartTime: null, lunchEndTime: null } : null, []);
  return { withBreaks, noBreaks };
}

/**
 * Evaluate one window. `startMin` null → the earliest start (15-minute steps, not before `notBeforeMin`) that passes every
 * check; none → invalid with the reason that blocked the most of the day. Order of the checks is the order the screen shows.
 */
export function evaluateWindow(f: DayFacts, startMin: number | null, durationMin: number, notBeforeMin = -1): Verdict {
  if (startMin == null) {
    const { withBreaks } = windowsOf(f.schedule);
    for (const w of withBreaks) for (let s = Math.ceil(Math.max(w.start, notBeforeMin) / 15) * 15; s + durationMin <= w.end; s += 15) {
      const v = evaluateWindow(f, s, durationMin, notBeforeMin); if (v.valid) return v;
    }
    const v = evaluateWindow(f, withBreaks[0]?.start ?? 0, durationMin, notBeforeMin);
    return { ...v, valid: false, start: null, end: null, reasons: v.reasons.length ? v.reasons : ['shift'] };
  }
  const end = startMin + durationMin; const { noBreaks } = windowsOf(f.schedule);
  const checks: Check[] = [];
  checks.push({ key: 'active', ok: f.active });
  checks.push({ key: 'branch', ok: f.inBranch });
  checks.push({ key: 'qualified', ok: f.missingServices.length === 0, ...(f.missingServices.length ? { detail: { missing: f.missingServices } } : {}) });
  checks.push({ key: 'past', ok: startMin >= notBeforeMin });
  const dayOff = f.scheduleSource === 'override_off' || f.scheduleSource === 'weekly_off_rule' || (f.schedule != null && f.schedule.isWorking === false);
  const startsInShift = !dayOff && noBreaks.some((w) => w.start <= startMin && startMin < w.end);
  const fitsShift = !dayOff && noBreaks.some((w) => w.start <= startMin && end <= w.end);
  checks.push({ key: 'shift', ok: startsInShift, detail: { source: f.scheduleSource, dayOff, windows: noBreaks.map((w) => `${hhmm(w.start)}–${hhmm(Math.min(w.end, 1439))}`) } });
  // the FULL duration must fit inside the shift: it only fails on its own when the start is inside but the service runs past the end
  checks.push({ key: 'duration', ok: !startsInShift || fitsShift, detail: { minutes: durationMin, end: hhmm(end) } });
  const brk = (f.schedule?.breaks?.length ? f.schedule.breaks : f.schedule?.lunchStartTime && f.schedule?.lunchEndTime ? [{ startTime: f.schedule.lunchStartTime, endTime: f.schedule.lunchEndTime, type: 'lunch' as const }] : [])
    .filter((b) => overlaps(startMin, end, pbMinutesOf(String(b.startTime).slice(0, 5)), pbMinutesOf(String(b.endTime).slice(0, 5))));
  checks.push({ key: 'breaks', ok: brk.length === 0, ...(brk.length ? { detail: { breaks: brk.map((b) => `${String(b.startTime).slice(0, 5)}–${String(b.endTime).slice(0, 5)}`) } } : {}) });
  const off = f.blocks.filter((b) => b.reason.startsWith('time_off') && overlaps(startMin, end, pbMinutesOf(b.startTime), pbMinutesOf(b.endTime)));
  checks.push({ key: 'time_off', ok: off.length === 0, ...(off.length ? { detail: { ranges: off.map((b) => `${b.startTime}–${b.endTime}`) } } : {}) });
  const blk = f.blocks.filter((b) => !b.reason.startsWith('time_off') && overlaps(startMin, end, pbMinutesOf(b.startTime), pbMinutesOf(b.endTime)));
  checks.push({ key: 'blocked', ok: blk.length === 0, ...(blk.length ? { detail: { ranges: blk.map((b) => `${b.startTime}–${b.endTime} (${b.reason})`) } } : {}) });
  const ap = f.appointments.filter((a) => overlaps(startMin, end, pbMinutesOf(a.startTime), pbMinutesOf(a.endTime)));
  checks.push({ key: 'appointments', ok: ap.length === 0, ...(ap.length ? { detail: { appointments: ap.map((a) => ({ id: a.id, start: a.startTime, end: a.endTime, status: a.status })) } } : {}) });
  const reasons = checks.filter((c) => !c.ok).map((c) => c.key);
  return { technicianId: f.technicianId, name: f.name, valid: reasons.length === 0, start: hhmm(startMin), end: hhmm(end), checks, reasons };
}

/**
 * Preferred first ONLY when valid; otherwise the qualified alternatives that pass every check at the same start (or, with no
 * desired start, their earliest valid start), ordered: exact start, then earliest start, then name. The preferred technician
 * is never in the alternatives. Nothing here ranks by queue position: the turn queue is not consulted or changed.
 */
export function rankPreferred(preferred: Verdict | null, alternatives: Verdict[], limit = 5) {
  const alts = alternatives.filter((a) => a.valid && a.technicianId !== preferred?.technicianId)
    .sort((a, b) => (Number(b.start === preferred?.start) - Number(a.start === preferred?.start)) || String(a.start).localeCompare(String(b.start)) || a.name.localeCompare(b.name) || a.technicianId.localeCompare(b.technicianId))
    .slice(0, limit);
  return { preferredFirst: !!preferred?.valid, preferred, alternatives: alts };
}
