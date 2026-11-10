// trend.ts — the Revenue & Appointments Trend buckets (SUNMI batch 9 guide 3, Nov 10 2026). Pure.
// Definitions (shown on the screen):
//  · revenue = sales before discounts (service + retail lines) — the Total Revenue card's basis, never the charged amount
//  · appointments = paid tickets (a ticket counts once in the bucket of its first payment) — the "Appointments completed" card
//  · time = the payment's salon day / hour in the branch time zone; buckets run oldest → newest and EVERY bucket of the
//    range is present (a successful query with no sales is a real 0, so a single busy day can't fill the whole chart)
//  · the bucket sums equal the KPI cards for the same period (asserted in tests)
import type { Tx } from './reports.repository';
import { addDays } from '@aipowersalon/date-time';

import type { TrendGroupBy, TrendBucket, RevenueTrend } from '@aipowersalon/api-contracts/tenant';
export type { TrendGroupBy, TrendBucket, TrendCompare, RevenueTrend } from '@aipowersalon/api-contracts/tenant';

const dayCount = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;

/** the sensible groupings for a period (never 365 daily bars, never hours across a month) */
export function groupByOptions(from: string, to: string): TrendGroupBy[] {
  const n = dayCount(from, to);
  if (n <= 1) return ['hour', 'day'];
  if (n <= 62) return ['day', 'week'];
  if (n <= 190) return ['day', 'week', 'month'];
  return ['week', 'month'];
}
export function defaultGroupBy(from: string, to: string): TrendGroupBy { return groupByOptions(from, to)[0]; }

/** ISO week (Monday start) of a YYYY-MM-DD */
const mondayOf = (d: string) => { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((wd + 6) % 7)); };

function localHour(iso: string, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return Number(h) % 24;
}

/** every bucket of [from, to] in order, each with its own salon-day range */
export function emptyBuckets(from: string, to: string, g: TrendGroupBy): TrendBucket[] {
  const out: TrendBucket[] = [];
  if (g === 'hour') { for (let h = 0; h < 24; h++) out.push({ key: `${from}T${String(h).padStart(2, '0')}`, from, to: from, revenueCents: 0, tickets: 0 }); return out; }
  let d = from;
  while (d <= to) {
    let end: string;
    if (g === 'day') end = d;
    else if (g === 'week') end = addDays(mondayOf(d), 6);
    else { const [y, m] = d.split('-').map(Number); const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); end = `${d.slice(0, 7)}-${String(last).padStart(2, '0')}`; }
    if (end > to) end = to;
    out.push({ key: g === 'week' ? 'W' + mondayOf(d) : g === 'month' ? d.slice(0, 7) : d, from: d, to: end, revenueCents: 0, tickets: 0 });
    d = addDays(end, 1);
  }
  return out;
}

/** completed (non-refund) report rows → the trend; rows are already filtered to the period and branch */
export function buildTrend(rows: Tx[], from: string, to: string, tz: string, requested?: string): RevenueTrend {
  const options = groupByOptions(from, to);
  const groupBy = (options as string[]).includes(String(requested)) ? (requested as TrendGroupBy) : options[0];
  const buckets = emptyBuckets(from, to, groupBy);
  const firstAt = new Map<string, { at: string; occurredAt?: string }>();
  for (const r of rows) {
    if (r.status !== 'completed') continue;
    const k = r.ticketId ?? r.id; const cur = firstAt.get(k);
    if (!cur || (r.occurredAt ?? r.at) < (cur.occurredAt ?? cur.at)) firstAt.set(k, { at: r.at, occurredAt: r.occurredAt });
  }
  const find = (at: string, occurredAt?: string) => groupBy === 'hour'
    ? buckets[occurredAt ? localHour(occurredAt, tz) : 0]
    : buckets.find((b) => at >= b.from && at <= b.to);
  for (const r of rows) {
    if (r.status !== 'completed') continue;
    const b = find(r.at, r.occurredAt); if (!b) continue;
    b.revenueCents += r.salesCents ?? r.grossCents;
  }
  for (const v of firstAt.values()) { const b = find(v.at, v.occurredAt); if (b) b.tickets += 1; }
  return { groupBy, groupByOptions: options, timezone: tz, buckets, totalRevenueCents: buckets.reduce((s, b) => s + b.revenueCents, 0), totalTickets: buckets.reduce((s, b) => s + b.tickets, 0) };
}

/** the previous period of the same length, ending the day before `from`; a 0 baseline is "insufficient data", never +∞% / 0% */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const n = dayCount(from, to); return { from: addDays(from, -n), to: addDays(from, -1) };
}
export function change(now: number, before: number): number | null { return before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null; }
