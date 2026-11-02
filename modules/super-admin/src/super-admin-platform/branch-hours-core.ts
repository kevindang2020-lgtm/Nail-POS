/**
 * branch-hours-core.ts — pure, DB-free validation for the branch operating-hours editor (§37).
 *
 * Hours live in tenant_location_hours keyed by (location_id, day_of_week) where day_of_week 0=Sunday. Times are stored
 * as 'HH:MM' branch-local strings. These helpers validate a submitted week (each day either closed, or a valid
 * opens<closes range) and normalize times; the repository upserts per day inside a transaction. Pure → unit-tested.
 */

export const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DayHoursInput { dayOfWeek?: unknown; isClosed?: unknown; opensAt?: unknown; closesAt?: unknown; }
export interface WeeklyHoursInput { days?: DayHoursInput[]; }
export interface DayHoursValue { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null; }
export type WeeklyHoursValidation = { ok: true; days: DayHoursValue[] } | { ok: false; errors: string[] };

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();
const toMinutes = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function validateWeeklyHours(input: WeeklyHoursInput | undefined): WeeklyHoursValidation {
  const days = Array.isArray(input?.days) ? input!.days! : [];
  const errors: string[] = [];
  if (days.length === 0) errors.push('No days were provided.');
  const seen = new Set<number>();
  const out: DayHoursValue[] = [];
  for (const d of days) {
    const dow = Number(d?.dayOfWeek);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) { errors.push(`Invalid day index: ${s(d?.dayOfWeek)}.`); continue; }
    if (seen.has(dow)) { errors.push(`Duplicate entry for ${DAY_LABELS[dow]}.`); continue; }
    seen.add(dow);
    const isClosed = d?.isClosed === true || s(d?.isClosed).toLowerCase() === 'true';
    if (isClosed) { out.push({ dayOfWeek: dow, isClosed: true, opensAt: null, closesAt: null }); continue; }
    const opensAt = s(d?.opensAt), closesAt = s(d?.closesAt);
    if (!HHMM.test(opensAt) || !HHMM.test(closesAt)) { errors.push(`${DAY_LABELS[dow]}: open and close must be valid times (HH:MM).`); continue; }
    if (toMinutes(opensAt) >= toMinutes(closesAt)) { errors.push(`${DAY_LABELS[dow]}: opening time must be before closing time.`); continue; }
    out.push({ dayOfWeek: dow, isClosed: false, opensAt, closesAt });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, days: out.sort((a, b) => a.dayOfWeek - b.dayOfWeek) };
}
