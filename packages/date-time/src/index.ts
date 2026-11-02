// @aipowersalon/date-time — the platform's calendar/time primitives (Constitution 13 §87).
//
// No date library: the code base never used one, and every helper here existed somewhere in the API as a hand-rolled
// Intl.DateTimeFormat decomposition (owner's zparts, reminders' tzOffsetMs, queue's todayInTimeZone, campaigns'
// localHour). One decomposition, `zonedParts`, underlies all of them. Dates on the wire are 'YYYY-MM-DD' strings;
// instants are Date/epoch ms; a SALON's day is `businessDate(tz)` — never toISOString().slice(0, 10), which is the
// UTC day and is wrong for a New Jersey salon after 8 pm.

export type Ymd = string;   // 'YYYY-MM-DD'
export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string | undefined): Intl.DateTimeFormat {
  const k = tz ?? '';
  let f = fmtCache.get(k);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' };
    try { f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }); }
    catch { f = new Intl.DateTimeFormat('en-US', opts); }   // unknown zone → the process zone, never a throw (queue's fallback)
    fmtCache.set(k, f);
  }
  return f;
}

/** The wall-clock parts of `instant` in `tz` (weekday 0 = Sunday). Unknown zones fall back to the process zone. */
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const m: Record<string, string> = {};
  for (const p of dtf(tz).formatToParts(instant)) if (p.type !== 'literal') m[p.type] = p.value;
  let hour = parseInt(m.hour, 10); if (hour === 24) hour = 0;   // some ICU builds print 24 for midnight
  return { year: +m.year, month: +m.month, day: +m.day, hour, minute: +m.minute, second: +m.second, weekday: WD[m.weekday] ?? 0 };
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** The salon's business day: 'YYYY-MM-DD' as the wall clock reads in `tz`. */
export function businessDate(tz: string, now: Date = new Date()): Ymd { const p = zonedParts(now, tz); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`; }
/** The UTC calendar day — the named form of `toISOString().slice(0, 10)`. Use for UTC-keyed data only, never for a salon's day. */
export function utcDate(now: Date = new Date()): Ymd { return now.toISOString().slice(0, 10); }
/** Hour of day (0–23) in `tz`. */
export function localHour(now: Date, tz: string): number { return zonedParts(now, tz).hour; }
/** `tz`'s offset from UTC at `at`, in ms (positive east of UTC). */
export function tzOffsetMs(at: Date, tz: string): number { const p = zonedParts(at, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime(); }
/** Epoch ms of a wall-clock date + 'HH:MM' in `tz` (two-pass offset resolution across DST); NaN when malformed. */
export function localDateTimeToEpochMs(dateStr: string, timeStr: string, tz: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim()); const tm = /^(\d{1,2}):(\d{2})/.exec((timeStr || '').trim());
  if (!dm || !tm) return NaN;
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0);
  const off1 = tzOffsetMs(new Date(guess), tz); const off2 = tzOffsetMs(new Date(guess - off1), tz);
  return guess - off2;
}
/** The instant `tz`'s current day began (its local midnight), as epoch ms — what SQL's date_trunc('day', now()) means
 *  for a salon. date_trunc on the server is the DATABASE's day (UTC): after 8 pm in New York it is already tomorrow. */
export function dayStartMs(tz: string, now: Date = new Date()): number { return localDateTimeToEpochMs(businessDate(tz, now), '00:00', tz); }
/** The instant `tz`'s current calendar month began (local midnight on the 1st), as epoch ms. */
export function monthStartMs(tz: string, now: Date = new Date()): number { return localDateTimeToEpochMs(businessDate(tz, now).slice(0, 8) + '01', '00:00', tz); }
/** 'YYYY-MM-DD' in `tz` for an epoch. */
export function epochToLocalDate(ms: number, tz: string): Ymd { return businessDate(tz, new Date(ms)); }

/** Strict 'YYYY-MM-DD' shape check (no calendar validation). */
/** A Postgres DATE column as YYYY-MM-DD. node-postgres hands a DATE back as a JS Date at LOCAL midnight (no type parser
 *  is installed), so `String(value).slice(0, 10)` gives "Thu Oct 23" — found Oct 23 2026 in the OCR receipts, the Tech
 *  App's appointment date, invoices and end-of-day follow-ups. A string (PGlite / a cast) passes through. */
export function dateColumnYmd(v: unknown): Ymd | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}
export function isYmd(s: unknown): s is Ymd { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
/** Calendar arithmetic on a 'YYYY-MM-DD' string, timezone-free (month ends and leap days handled by Date.UTC). */
export function addDays(ymd: Ymd, days: number): Ymd {
  const [y, m, d] = ymd.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}
/** 'H:MM' / 'HH:MM' → minutes since midnight, or null when malformed or out of range. */
export function minutesSinceMidnight(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim()); if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]); if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// ── BUILD_PLAN Phase 13 (Constitution 6 §98–99): display formatting for the mobile apps, moved here from ~25 local
// `fmtDate` / `fmtTime` one-liners. Every function takes the BUSINESS time zone (the branch's — §99: an appointment is
// shown in the salon's zone even when the phone is elsewhere) and a display locale (the user's language, en-US default).
// `tz` undefined = the device zone, which is exactly what the replaced formatters did, so a phone in the salon's zone
// prints byte-identical text. Invalid input → '' (the replaced formatters' rule), never "Invalid Date".

type Instant = string | number | Date | null | undefined;
const toDate = (x: Instant): Date | null => {
  if (x === null || x === undefined || x === '') return null;
  const d = x instanceof Date ? x : new Date(x);
  return isNaN(d.getTime()) ? null : d;
};
const withZone = (o: Intl.DateTimeFormatOptions, tz?: string | null): Intl.DateTimeFormatOptions => {
  if (!tz) return o;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return { ...o, timeZone: tz }; } catch { return o; }   // unknown zone → device zone
};

/** Any Intl options, in `tz`, for an ISO instant / epoch / Date. */
export function formatInZone(x: Instant, opts: Intl.DateTimeFormatOptions, tz?: string | null, locale = 'en-US'): string {
  const d = toDate(x); if (!d) return '';
  try { return d.toLocaleString(locale, withZone(opts, tz)); } catch { return ''; }
}
/** "Oct 9, 2026" */
export const formatShortDate = (x: Instant, tz?: string | null, locale = 'en-US') => formatInZone(x, { month: 'short', day: 'numeric', year: 'numeric' }, tz, locale);
/** "Oct 9" */
export const formatMonthDay = (x: Instant, tz?: string | null, locale = 'en-US') => formatInZone(x, { month: 'short', day: 'numeric' }, tz, locale);
/** "3:05 PM" */
export const formatTimeOfDay = (x: Instant, tz?: string | null, locale = 'en-US') => formatInZone(x, { hour: 'numeric', minute: '2-digit' }, tz, locale);
/** "Oct 9, 3:05 PM" */
export const formatMonthDayTime = (x: Instant, tz?: string | null, locale = 'en-US') => formatInZone(x, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, tz, locale);

/** A calendar DATE ('YYYY-MM-DD', no time, no zone) — never shifted by any zone. Invalid → `fallback` (default ''). */
export function formatYmd(ymd: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }, locale = 'en-US', fallback = ''): string {
  if (!ymd || !isYmd(String(ymd).slice(0, 10))) return fallback;
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(t.getTime())) return fallback;
  try { return t.toLocaleDateString(locale, { ...opts, timeZone: 'UTC' }); } catch { return fallback; }
}
/** 'HH:MM' (24 h wall clock) → "2:30 PM"; '' when malformed. */
export function formatHhmm12(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? '').trim()); if (!m) return '';
  let h = Number(m[1]); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
