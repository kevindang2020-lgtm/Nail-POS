/**
 * earnings-period.ts — THE window resolver for technician earnings reads (Tech App /tech/earnings/canonical; Payroll
 * mandate §126 time-zone handling, §128 one earning-date policy). Ported from the other chat's Technician Profile phase 2
 * (Oct 12 2026), rebuilt on @aipowersalon/date-time (the ONE timezone library) instead of the owner dashboard's helpers.
 *  • every window is HALF-OPEN [fromIso, toIso) — a ticket paid exactly at a boundary belongs to ONE period;
 *  • "today" / "week" / "month" are the TENANT's civil calendar, never the API server's clock zone (weeks start Monday);
 *  • `custom` is capped at MAX_CUSTOM_RANGE_DAYS (92) — anything longer is clamped from the start date;
 *  • `pay_period` maps a payroll_periods row (DATE start/end, inclusive) onto [start 00:00, end+1 00:00) tenant-local.
 * Pure: the caller supplies the pay-period row; no I/O here.
 */
import { addDays, businessDate, localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';

export type EarningsWindowPeriod = 'day' | 'week' | 'month' | 'custom' | 'pay_period';
export interface EarningsWindow { period: EarningsWindowPeriod; fromIso: string; toIso: string; timezone: string; clamped?: boolean; payPeriodId?: string }

export const MAX_CUSTOM_RANGE_DAYS = 92;
const DAY_MS = 86_400_000;

/** tenant-local midnight of a YYYY-MM-DD civil date, as an ISO instant. */
function civilMidnightIso(ymd: string, tz: string): string {
  const ms = localDateTimeToEpochMs(ymd, '00:00', tz);
  if (Number.isNaN(ms)) throw new Error('invalid date ' + ymd);
  return new Date(ms).toISOString();
}

export function resolveEarningsWindow(
  args: { period?: string; dateIso?: string; dateToIso?: string; timezone: string; nowMs?: number; payPeriod?: { id: string; periodStart: string; periodEnd: string } | null },
): EarningsWindow {
  const tz = args.timezone || 'UTC';
  const now = new Date(args.nowMs ?? Date.now());
  const period = (args.period || 'day') as EarningsWindowPeriod;

  if (period === 'pay_period') {
    if (!args.payPeriod) throw new Error('pay_period requires a payroll period');
    const start = String(args.payPeriod.periodStart).slice(0, 10);
    const end = String(args.payPeriod.periodEnd).slice(0, 10);
    return { period, fromIso: civilMidnightIso(start, tz), toIso: civilMidnightIso(addDays(end, 1), tz), timezone: tz, payPeriodId: args.payPeriod.id };
  }

  if (period === 'custom') {
    const a = args.dateIso ? Date.parse(args.dateIso) : NaN;
    const b = args.dateToIso ? Date.parse(args.dateToIso) : NaN;
    if (Number.isNaN(a) || Number.isNaN(b) || b <= a) throw new Error('custom requires date < dateTo');
    const from = new Date(a);
    let to = new Date(b); let clamped = false;
    if (to.getTime() - from.getTime() > MAX_CUSTOM_RANGE_DAYS * DAY_MS) { to = new Date(from.getTime() + MAX_CUSTOM_RANGE_DAYS * DAY_MS); clamped = true; }
    return { period, fromIso: from.toISOString(), toIso: to.toISOString(), timezone: tz, clamped };
  }

  const parsed = args.dateIso ? Date.parse(args.dateIso) : NaN;
  const anchor = Number.isNaN(parsed) ? now : new Date(parsed);
  const day = businessDate(tz, anchor);
  if (period === 'week') {
    const wd = zonedParts(anchor, tz).weekday;               // 0 = Sunday
    const monday = addDays(day, -((wd + 6) % 7));
    return { period, fromIso: civilMidnightIso(monday, tz), toIso: civilMidnightIso(addDays(monday, 7), tz), timezone: tz };
  }
  if (period === 'month') {
    const first = day.slice(0, 8) + '01';
    const [y, m] = first.split('-').map(Number);
    const nextFirst = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    return { period, fromIso: civilMidnightIso(first, tz), toIso: civilMidnightIso(nextFirst, tz), timezone: tz };
  }
  return { period: 'day', fromIso: civilMidnightIso(day, tz), toIso: civilMidnightIso(addDays(day, 1), tz), timezone: tz };
}

/** PURE: is `instantIso` inside the half-open window? (the boundary rule, spelled out for tests) */
export function inWindow(instantIso: string, w: { fromIso: string; toIso: string }): boolean {
  const t = Date.parse(instantIso);
  return t >= Date.parse(w.fromIso) && t < Date.parse(w.toIso);
}
