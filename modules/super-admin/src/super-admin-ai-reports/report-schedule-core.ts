// Pure logic for report schedules. No DB/Nest deps. Computes the next run time, derives the schedule-occurrence
// idempotency key (the guarantee that one occurrence ⇒ one run), validates schedule input, and governs status changes.
// NOTE: next-run math is computed in UTC; full timezone/DST resolution is a documented follow-up (needs a tz library).

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export function parseTime(hhmm: string): { h: number; m: number } | null {
  const mt = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!mt) return null;
  const h = Number(mt[1]), m = Number(mt[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

// Smallest occurrence strictly after `fromMs`, at the given UTC time, stepping by the frequency interval.
export function computeNextRunAt(frequency: string, time: string, fromMs: number): number | null {
  const t = parseTime(time); if (!t) return null;
  const f = String(frequency || '').toLowerCase();
  const base = new Date(fromMs);
  const cand = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), t.h, t.m, 0, 0);
  const dayMs = 86400000;
  if (f === 'daily') return cand > fromMs ? cand : cand + dayMs;
  if (f === 'weekly') { let c = cand; while (c <= fromMs) c += 7 * dayMs; return c; }
  const stepMonths = f === 'monthly' ? 1 : f === 'quarterly' ? 3 : f === 'yearly' ? 12 : 0;
  if (stepMonths > 0) {
    const y = base.getUTCFullYear(); let mo = base.getUTCMonth();
    let c = Date.UTC(y, mo, 1, t.h, t.m, 0, 0);
    while (c <= fromMs) { mo += stepMonths; c = Date.UTC(y, mo, 1, t.h, t.m, 0, 0); }
    return c;
  }
  return null;
}

// (schedule id + occurrence instant) ⇒ a stable key. Two executions of the same occurrence collapse to one run.
export function buildScheduleOccurrenceKey(scheduleId: string, occurrenceIso: string): string {
  return `sched|${String(scheduleId || '').trim()}|${new Date(occurrenceIso).toISOString()}`;
}

export type ValidateResult = { ok: true } | { ok: false; reason: string };
export function validateScheduleInput(input: { name?: string; reportKey?: string; frequency?: string; runAtTime?: string; startMs?: number; nowMs: number }): ValidateResult {
  if (!String(input.name || '').trim()) return { ok: false, reason: 'schedule name is required' };
  if (!String(input.reportKey || '').trim()) return { ok: false, reason: 'reportKey is required' };
  if (!FREQUENCIES.includes(String(input.frequency || '').toLowerCase() as Frequency)) return { ok: false, reason: `unsupported frequency "${input.frequency}"` };
  if (!parseTime(String(input.runAtTime || ''))) return { ok: false, reason: 'runAtTime must be HH:MM' };
  if (input.startMs != null && input.startMs < input.nowMs - 60000) return { ok: false, reason: 'start date cannot be in the past' };
  return { ok: true };
}

export const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['active', 'archived'], active: ['paused', 'disabled', 'completed'], paused: ['active', 'disabled', 'archived'],
  disabled: ['archived'], completed: ['archived'], archived: [],
};
export function canScheduleTransition(from: string, to: string): boolean {
  return (STATUS_TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase());
}
