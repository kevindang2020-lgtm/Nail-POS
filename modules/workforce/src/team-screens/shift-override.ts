// shift-override.ts — F4 (Finish the Five, 30 Oct 2026): validation and conflict evaluation for a ONE-DATE shift edit,
// PURE (no I/O). The repository loads the canonical rows (weekly template, appointments, time off, queue) and saves only
// after this says the edit is valid and the manager has seen every conflict. Nothing here cancels, shortens or moves a
// booking: a conflict is shown with the booking ids and times, and the manager chooses (cancel edit, adjust, reschedule).
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';

export const OVERRIDE_TYPES = ['CUSTOM_SHIFT', 'DAY_OFF', 'RESTORE_BASELINE'] as const;
export type OverrideType = typeof OVERRIDE_TYPES[number];
export const BREAK_TYPES = ['lunch', 'paid', 'unpaid'] as const;
export interface ProposedBreak { type: string; startLocalTime: string; endLocalTime: string }
export interface Proposed { overrideType: OverrideType; startLocalTime?: string | null; endLocalTime?: string | null; endsNextDay?: boolean | null; breaks?: ProposedBreak[] | null }
export interface Window { start: number; end: number }            // minutes from 00:00 of the edited date; end may pass 1440 (overnight)
export interface DayAppointment { id: string; date: string; startTime: string; endTime: string; status: string; customer?: string | null }
export interface ConflictInput {
  date: string; tz: string; today: string; nowMinute: number;
  proposed: { working: Window[]; breaks: (Window & { type: string })[] };
  appointments: DayAppointment[];                // the edited date AND (for an overnight shift) the next date
  timeOff: { id: string; startsAtMs: number; endsAtMs: number; kind: string | null }[];
  activeQueue: { id: string; status: string }[]; // today only: accepted / in service tickets of this technician
  otherBranch: { branchId: string; window: Window }[];
}
export type ConflictKind = 'OUTSIDE_SHIFT' | 'BREAK_OVERLAP' | 'TIME_OFF' | 'ACTIVE_QUEUE' | 'CROSS_BRANCH';
export interface Conflict { kind: ConflictKind; blocking: boolean; appointmentId?: string; date?: string; startTime?: string; endTime?: string; detail: string }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const minutes = (t: string) => { const m = HHMM.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const hhmm = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const ACTIVE = new Set(['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service']);
export class OverrideValidationError extends Error { constructor(public readonly code: string, msg: string) { super(msg); } }

/** validate the request and turn it into minute windows on the edited date (overnight end > 1440) */
export function normalize(p: Proposed): { working: Window[]; breaks: (Window & { type: string })[]; start: string | null; end: string | null; endsNextDay: boolean; breakRows: ProposedBreak[] } {
  if (!(OVERRIDE_TYPES as readonly string[]).includes(p.overrideType)) throw new OverrideValidationError('INVALID_OVERRIDE_TYPE', 'Choose Create shift, Mark off or Restore recurring.');
  if (p.overrideType !== 'CUSTOM_SHIFT') return { working: [], breaks: [], start: null, end: null, endsNextDay: false, breakRows: [] };
  const s = minutes(String(p.startLocalTime ?? '')), e = minutes(String(p.endLocalTime ?? ''));
  if (!Number.isFinite(s) || !Number.isFinite(e)) throw new OverrideValidationError('INVALID_TIME', 'Enter the start and end as HH:MM.');
  const overnight = !!p.endsNextDay;
  if (!overnight && e <= s) throw new OverrideValidationError('END_BEFORE_START', 'The end must be after the start (or mark the shift as ending the next day).');
  if (overnight && e > s) throw new OverrideValidationError('OVERNIGHT_END', 'An overnight shift ends the next morning — its end must be earlier than its start.');
  const end = overnight ? e + 1440 : e;
  if (end - s > 16 * 60) throw new OverrideValidationError('SHIFT_TOO_LONG', 'A shift can be at most 16 hours.');
  const rows = (p.breaks ?? []).slice(0, 6);
  const breaks = rows.map((b) => {
    if (!(BREAK_TYPES as readonly string[]).includes(b.type)) throw new OverrideValidationError('INVALID_BREAK_TYPE', 'A break is lunch, paid or unpaid.');
    let bs = minutes(b.startLocalTime), be = minutes(b.endLocalTime);
    if (!Number.isFinite(bs) || !Number.isFinite(be)) throw new OverrideValidationError('INVALID_BREAK', 'Enter each break as HH:MM – HH:MM.');
    if (overnight && bs < s) { bs += 1440; be += 1440; }            // a break after midnight
    if (be <= bs) throw new OverrideValidationError('INVALID_BREAK', 'A break must end after it starts.');
    if (bs < s || be > end) throw new OverrideValidationError('BREAK_OUTSIDE_SHIFT', 'Every break must be inside the shift.');
    return { start: bs, end: be, type: b.type };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < breaks.length; i++) if (breaks[i].start < breaks[i - 1].end) throw new OverrideValidationError('BREAKS_OVERLAP', 'Two breaks overlap.');
  return { working: [{ start: s, end }], breaks, start: hhmm(s), end: hhmm(e), endsNextDay: overnight, breakRows: rows.map((b) => ({ type: b.type, startLocalTime: b.startLocalTime, endLocalTime: b.endLocalTime })) };
}

/** branch-local → UTC for the shift (DST-correct: the real length of a shift on a change-over night) */
export function shiftInstants(date: string, w: Window | undefined, tz: string, nextDate: string) {
  if (!w) return null;
  const at = (m: number) => (m >= 1440 ? localDateTimeToEpochMs(nextDate, hhmm(m - 1440), tz) : localDateTimeToEpochMs(date, hhmm(m), tz));
  const s = at(w.start), e = at(w.end);
  return { startsAtUtc: new Date(s).toISOString(), endsAtUtc: new Date(e).toISOString(), actualMinutes: Math.round((e - s) / 60_000), wallMinutes: w.end - w.start };
}

export function evaluateConflicts(c: ConflictInput, nextDate: string): Conflict[] {
  const out: Conflict[] = [];
  const within = (s: number, e: number) => c.proposed.working.some((w) => s >= w.start && e <= w.end);
  const covered = (s: number, e: number) => c.proposed.working.some((w) => s < w.end && e > w.start);
  const lastEnd = c.proposed.working.reduce((m, w) => Math.max(m, w.end), 0);
  for (const a of c.appointments) {
    if (!ACTIVE.has(a.status)) continue;
    const off = a.date === c.date ? 0 : a.date === nextDate ? 1440 : null; if (off == null) continue;
    const s = minutes(a.startTime) + off; let e = minutes(a.endTime) + off; if (!Number.isFinite(s) || !Number.isFinite(e)) continue; if (e <= s) e += 1440;
    // a next-day appointment only matters for the early-morning part of an overnight shift
    if (off === 1440 && !(lastEnd > 1440 && s < lastEnd)) continue;
    if (!within(s, e)) out.push({ kind: 'OUTSIDE_SHIFT', blocking: true, appointmentId: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime,
      detail: c.proposed.working.length ? `Booked ${a.startTime}–${a.endTime} is outside the new hours.` : `Booked ${a.startTime}–${a.endTime} on a day marked off.` });
    for (const b of c.proposed.breaks) if (s < b.end && e > b.start) out.push({ kind: 'BREAK_OVERLAP', blocking: true, appointmentId: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime,
      detail: `Booked ${a.startTime}–${a.endTime} overlaps the ${b.type} break ${hhmm(b.start)}–${hhmm(b.end)}.` });
  }
  for (const t of c.timeOff) {
    const ws = c.proposed.working.map((w) => ({ s: localDateTimeToEpochMs(c.date, '00:00', c.tz) + w.start * 60_000, e: localDateTimeToEpochMs(c.date, '00:00', c.tz) + w.end * 60_000 }));
    if (ws.some((w) => t.startsAtMs < w.e && t.endsAtMs > w.s)) out.push({ kind: 'TIME_OFF', blocking: false, detail: `Approved time off (${(t.kind ?? 'time off').toLowerCase()}) overlaps this shift; time off still applies.` });
  }
  if (c.date === c.today && c.activeQueue.length) {
    const stopsNow = !c.proposed.working.some((w) => w.end > c.nowMinute && w.start <= c.nowMinute);
    if (stopsNow) for (const q of c.activeQueue) out.push({ kind: 'ACTIVE_QUEUE', blocking: true, detail: `An active Tech Queue ticket (${q.status.replace(/_/g, ' ')}) is with this technician now.` });
  }
  for (const o of c.otherBranch) if (covered(o.window.start, o.window.end)) out.push({ kind: 'CROSS_BRANCH', blocking: true, detail: `This technician already has a shift at another branch ${hhmm(o.window.start)}–${hhmm(o.window.end)} that day.` });
  return out;
}
