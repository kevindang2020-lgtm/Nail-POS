/**
 * Timezone-aware time helpers. The board reasons internally in
 * "minutes since local midnight of the selected date in the branch timezone"
 * and converts to/from ISO-8601 strings with offsets only at the edges.
 */
import { GRID_MINUTES, type HHmm, type ISODate, type ISODateTime } from './scheduleTypes';

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(timezone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timezone, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(timezone: string, date: Date): Parts {
  const p: Record<string, number> = {};
  for (const part of dtf(timezone).formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour === 24 ? 0 : p.hour,
    minute: p.minute,
    second: p.second,
  };
}

/** Offset (minutes east of UTC) of `timezone` at the given instant. */
export function tzOffsetMinutes(timezone: string, at: Date): number {
  const p = partsIn(timezone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** Local wall-clock (date + minutes since midnight) → instant in `timezone`. */
export function localToInstant(date: ISODate, minuteOfDay: number, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + minuteOfDay * 60000;
  // Two-pass offset resolution handles DST boundaries.
  let guess = naive - tzOffsetMinutes(timezone, new Date(naive)) * 60000;
  guess = naive - tzOffsetMinutes(timezone, new Date(guess)) * 60000;
  return new Date(guess);
}

/** Local wall-clock → ISO-8601 with the correct offset for `timezone`. */
export function toISO(date: ISODate, minuteOfDay: number, timezone: string): ISODateTime {
  const inst = localToInstant(date, minuteOfDay, timezone);
  const off = tzOffsetMinutes(timezone, inst);
  const p = partsIn(timezone, inst);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(
    p.second,
  )}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** ISO date-time → calendar date in `timezone`. */
export function dateOf(iso: ISODateTime, timezone: string): ISODate {
  const p = partsIn(timezone, new Date(iso));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * ISO date-time → minutes since local midnight of `date` in `timezone`.
 * Instants on other days yield values outside 0..1440 (negative or >1440),
 * which lets callers clip to the day naturally.
 */
export function minuteOfDay(iso: ISODateTime, date: ISODate, timezone: string): number {
  const midnight = localToInstant(date, 0, timezone).getTime();
  return Math.round((new Date(iso).getTime() - midnight) / 60000);
}

export function hhmmToMinutes(v: HHmm): number {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHHmm(min: number): HHmm {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function ceilToGrid(min: number, grid = GRID_MINUTES): number {
  return Math.ceil(min / grid) * grid;
}

export function floorToGrid(min: number, grid = GRID_MINUTES): number {
  return Math.floor(min / grid) * grid;
}

export function isOnGrid(min: number, grid = GRID_MINUTES): boolean {
  return min % grid === 0;
}

/** `9:00 AM`, `12:15 PM`. */
export function formatClock(min: number, opts: { suffix?: boolean } = {}): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const base = `${h12}:${pad(mm)}`;
  if (opts.suffix === false) return base;
  return `${base} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** `9:00 – 10:00 AM` (shared suffix when both halves share a meridiem). */
export function formatRange(startMin: number, endMin: number): string {
  const endForMeridiem = endMin >= 1440 ? 1439 : endMin;
  const sameMeridiem = Math.floor((startMin % 1440) / 720) === Math.floor(endForMeridiem / 720);
  if (sameMeridiem) return `${formatClock(startMin, { suffix: false })} – ${formatClock(endMin)}`;
  return `${formatClock(startMin)} – ${formatClock(endMin)}`;
}

/** `Wed, May 6, 2026` in the given timezone. */
export function formatLongDate(date: ISODate, timezone: string): string {
  const inst = localToInstant(date, 12 * 60, timezone);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(inst);
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function todayIn(timezone: string, now: Date = new Date()): ISODate {
  return dateOf(now.toISOString(), timezone);
}

/** Monday-first week containing `date`. */
export function weekDates(date: ISODate): ISODate[] {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const offsetToMonday = (dow + 6) % 7;
  const monday = addDays(date, -offsetToMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
