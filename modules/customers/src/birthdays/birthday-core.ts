// birthday-core.ts — Birthday Campaigns guide (Oct 31 2026) §05–§08: the ONE place a stored birthday becomes a yearly
// occurrence. Pure, no I/O, no timezone math: callers pass the SALON-LOCAL calendar date ("today", YYYY-MM-DD) and get
// calendar dates back. A birthday is a calendar date, never an instant — it is never run through `new Date(...)`.
//
//   stored         customers.birthday (DATE) + birthday_year_known (750). A month/day entered without a year is stored on
//                  the leap year 2000 (so 02-29 is representable) with birthday_year_known = false; the year is never shown.
//   occurrence     the month/day in a target calendar year. 02-29 in a non-leap year follows the salon's Feb 29 policy
//                  (tenant_birthday_settings.feb29_policy: 'feb28' default | 'mar1'); the stored date is never rewritten.
//   next           the first occurrence on/after today (Dec 31 → Jan 1 wraps into next year).
//   occasion year  the year of the occurrence CLOSEST to a send date — the key for "one birthday message per customer per year".
export const FEB29_POLICIES = ['feb28', 'mar1'] as const;
export type Feb29Policy = (typeof FEB29_POLICIES)[number];
export const BIRTHDAY_RULESET = 'birthdays-v1';
export const UNKNOWN_YEAR = 2000;   // leap: holds 02-29
export interface MonthDay { month: number; day: number }
export interface ParsedBirthday { date: string; yearKnown: boolean; month: number; day: number }

const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

/** a calendar date string → its parts, or null (never shifts through a timezone) */
export function parts(v: unknown): { y: number; m: number; d: number } | null {
  if (v == null) return null;
  let s: string;
  // Drivers disagree on DATE: node-postgres returns a JS Date at LOCAL midnight; PGlite returns UTC midnight. An instant at
  // exactly UTC midnight is read in UTC; any other instant is a local midnight and is read locally. Both give the stored
  // calendar date in every server timezone (callers that can should select the DATE as text — then no Date is involved).
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const utcMidnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 && v.getUTCMilliseconds() === 0;
    return utcMidnight ? { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() } : { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > DIM[mo - 1] || (mo === 2 && d === 29 && !isLeap(y))) return null;
  return { y, m: mo, d };
}
/** the stored DATE as YYYY-MM-DD (the profile display bug: String(Date).slice(0,10) gave "Thu Oct 01") */
export function storedDateString(v: unknown): string | null { const p = parts(v); return p ? ymd(p.y, p.m, p.d) : null; }
export function monthDayOf(v: unknown): MonthDay | null { const p = parts(v); return p ? { month: p.m, day: p.d } : null; }

/**
 * Staff / import input → what to store. Accepts YYYY-MM-DD (year known) or MM-DD (year unknown).
 * Accepts --MM-DD (ISO month-day) too. Refuses impossible dates, a future birth date, and a birth year before 1901
 * (1900 was the CSV import's old "year unknown" sentinel — 750 marks those rows year-unknown). `today` is the salon-local date.
 */
export function parseBirthdayInput(v: unknown, today: string): { ok: true; value: ParsedBirthday } | { ok: false; reason: string } {
  const s = typeof v === 'string' ? v.trim() : '';
  const md = /^(?:--)?(\d{2})-(\d{2})$/.exec(s);
  if (md) {
    const m = Number(md[1]), d = Number(md[2]);
    if (m < 1 || m > 12 || d < 1 || d > DIM[m - 1]) return { ok: false, reason: 'That month and day do not exist.' };
    return { ok: true, value: { date: ymd(UNKNOWN_YEAR, m, d), yearKnown: false, month: m, day: d } };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, reason: 'Enter the birthday as YYYY-MM-DD, or MM-DD when the year is not known.' };
  const p = parts(s);
  if (!p) return { ok: false, reason: 'That date does not exist.' };
  if (p.y <= 1900) return { ok: false, reason: 'The birth year must be after 1900.' };
  if (s > today) return { ok: false, reason: 'A birthday cannot be in the future.' };
  return { ok: true, value: { date: s, yearKnown: true, month: p.m, day: p.d } };
}

/** the calendar date this month/day falls on in `year` (Feb 29 policy in non-leap years) */
export function occurrence(md: MonthDay, year: number, policy: Feb29Policy = 'feb28'): string {
  if (md.month === 2 && md.day === 29 && !isLeap(year)) return policy === 'mar1' ? ymd(year, 3, 1) : ymd(year, 2, 28);
  return ymd(year, md.month, md.day);
}
const toDays = (d: string) => { const p = parts(d)!; return Date.UTC(p.y, p.m - 1, p.d) / 86400000; };
export const daysBetween = (a: string, b: string) => Math.round(toDays(b) - toDays(a));
export const addDays = (d: string, n: number) => { const x = new Date((toDays(d) + n) * 86400000); return ymd(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); };

/** first occurrence on/after `today` — wraps Dec 31 → next year */
export function nextOccurrence(md: MonthDay, today: string, policy: Feb29Policy = 'feb28'): { date: string; daysUntil: number } {
  const y = parts(today)!.y;
  let d = occurrence(md, y, policy);
  if (d < today) d = occurrence(md, y + 1, policy);
  return { date: d, daysUntil: daysBetween(today, d) };
}
/** every occurrence in [from, to] (inclusive; a range may cross years) */
export function occurrencesIn(md: MonthDay, from: string, to: string, policy: Feb29Policy = 'feb28'): string[] {
  const out: string[] = [];
  for (let y = parts(from)!.y; y <= parts(to)!.y; y++) { const d = occurrence(md, y, policy); if (d >= from && d <= to) out.push(d); }
  return out;
}
/** the year of the occurrence closest to `onDate` — the "occasion year" (a Dec 28 send for a Jan 2 birthday is next year's) */
export function occasionYear(md: MonthDay, onDate: string, policy: Feb29Policy = 'feb28'): number {
  const y = parts(onDate)!.y;
  let best = y, bestGap = Infinity;
  for (const cand of [y - 1, y, y + 1]) { const g = Math.abs(daysBetween(onDate, occurrence(md, cand, policy))); if (g < bestGap) { bestGap = g; best = cand; } }
  return best;
}
/** does the month/day land in calendar month `month` of `year` (Feb 29 → Mar 1 policy moves it to March in non-leap years) */
export function inMonth(md: MonthDay, month: number, year: number, policy: Feb29Policy = 'feb28'): boolean {
  return parts(occurrence(md, year, policy))!.m === month;
}
export const isFeb29Policy = (v: unknown): v is Feb29Policy => (FEB29_POLICIES as readonly string[]).includes(String(v));

/** a stored-or-imported birthday string → the row to store: '--MM-DD' (import, year unknown) → 2000-MM-DD + yearKnown false */
export function toStorage(v: string | null | undefined): { date: string; yearKnown: boolean } | null {
  if (!v) return null;
  const md = /^--(\d{2})-(\d{2})$/.exec(v);
  if (md) return { date: ymd(UNKNOWN_YEAR, Number(md[1]), Number(md[2])), yearKnown: false };
  return parts(v) ? { date: v.slice(0, 10), yearKnown: true } : null;
}
