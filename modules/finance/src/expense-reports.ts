// expense-reports.ts — the date windows every expense report uses, recurring-charge detection, and the insight lines
// (mandate §87–95, §104–108, §178–179). The money itself is summed in SQL (expense.repository.ts); this file decides
// WHICH days a report covers and turns the sums into the owner's summary. Every window is in the SALON's own calendar
// (incurred_on is the salon-local date), so "This Month" means the salon's month, not UTC's.
import { addDays, isYmd } from '@aipowersalon/date-time';

export type ReportPeriod = 'today' | 'week' | 'month' | 'year' | 'last_month' | 'last_year' | 'custom';
export interface DateWindow { from: string; to: string }   // inclusive salon-local dates

const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** §87: Today / This Week (Mon–Sun) / This Month / This Year / Custom; plus the prior month / year for comparisons. */
export function periodWindow(period: ReportPeriod, today: string, custom?: { from?: string; to?: string }): DateWindow {
  if (!isYmd(today)) throw new Error('today must be YYYY-MM-DD');
  const [y, m, d] = today.split('-').map(Number);
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'week': { const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; const from = addDays(today, -dow); return { from, to: addDays(from, 6) }; }
    case 'month': return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) };
    case 'year': return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) };
    case 'last_month': { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) }; }
    case 'last_year': return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) };
    case 'custom': {
      const from = custom?.from, to = custom?.to;
      if (!isYmd(from) || !isYmd(to) || from > to) throw new Error('custom range needs from ≤ to as YYYY-MM-DD');
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366 * 3) throw new Error('custom range is limited to three years');
      return { from, to };
    }
  }
}

/** The window of the same length immediately before `w` — "this month vs last month" (§91). Month/year align to calendars. */
export function previousWindow(period: ReportPeriod, w: DateWindow): DateWindow {
  if (period === 'month') return periodWindow('last_month', w.from);
  if (period === 'year') return periodWindow('last_year', w.from);
  const len = Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1;
  return { from: addDays(w.from, -len), to: addDays(w.from, -1) };
}

/** Percent change, one decimal, or null when there is no base to compare to (never Infinity). */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// ── recurring charges (§57–59): suggested, never created without approval ──────────────────────────────────────────
export interface ChargeRow { vendorKey: string; vendorLabel: string; incurredOn: string; amountCents: number; categoryKey: string }
export interface RecurringSuggestion { vendorKey: string; vendorLabel: string; categoryKey: string; cadence: 'monthly'; typicalAmountCents: number; occurrences: number; lastCharge: string; nextExpected: string; annualizedCents: number }

/**
 * A vendor that charged a similar amount (±10%) in at least three of the last months, roughly a month apart, looks
 * like a monthly recurring expense. Returns suggestions only — the owner chooses whether to mark it recurring.
 */
export function detectRecurring(rows: readonly ChargeRow[]): RecurringSuggestion[] {
  const byVendor = new Map<string, ChargeRow[]>();
  for (const r of rows) { if (!r.vendorKey) continue; const a = byVendor.get(r.vendorKey) ?? []; a.push(r); byVendor.set(r.vendorKey, a); }
  const out: RecurringSuggestion[] = [];
  for (const [vendorKey, list] of byVendor) {
    const sorted = [...list].sort((a, b) => a.incurredOn.localeCompare(b.incurredOn));
    const months = new Map<string, ChargeRow>();
    for (const r of sorted) months.set(r.incurredOn.slice(0, 7), r);       // last charge of each month
    const series = [...months.values()];
    if (series.length < 3) continue;
    const recent = series.slice(-6);
    const amounts = recent.map((r) => r.amountCents).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const similar = recent.filter((r) => Math.abs(r.amountCents - median) <= Math.max(100, median * 0.1));
    if (similar.length < 3) continue;
    const gaps: number[] = [];
    for (let i = 1; i < similar.length; i++) gaps.push((Date.parse(similar[i].incurredOn) - Date.parse(similar[i - 1].incurredOn)) / 86400000);
    if (!gaps.every((g) => g >= 20 && g <= 40)) continue;
    const last = similar[similar.length - 1];
    out.push({ vendorKey, vendorLabel: last.vendorLabel, categoryKey: last.categoryKey, cadence: 'monthly', typicalAmountCents: median, occurrences: similar.length, lastCharge: last.incurredOn, nextExpected: addDays(last.incurredOn, Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)), annualizedCents: median * 12 });
  }
  return out.sort((a, b) => b.annualizedCents - a.annualizedCents);
}

// ── advisory insight lines (§95–96): plain sentences from the sums — advisory, never an accusation ────────────────────
export interface InsightInput { categoryNow: Record<string, number>; categoryBefore: Record<string, number>; labels: Record<string, string>; possibleDuplicates: number; needsReview: number; overdueBills: number; newVendorsThisPeriod: number }
export function expenseInsights(x: InsightInput): string[] {
  const out: string[] = [];
  const moves = Object.keys({ ...x.categoryNow, ...x.categoryBefore })
    .map((k) => ({ k, now: x.categoryNow[k] ?? 0, before: x.categoryBefore[k] ?? 0 }))
    .filter((m) => m.before >= 5000 && m.now > 0)
    .map((m) => ({ ...m, pct: pctChange(m.now, m.before) ?? 0 }))
    .filter((m) => Math.abs(m.pct) >= 15)
    .sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before))
    .slice(0, 3);
  for (const m of moves) out.push(`${x.labels[m.k] ?? m.k} spending ${m.pct > 0 ? 'increased' : 'decreased'} ${Math.abs(m.pct)}% compared with the previous period.`);
  if (x.possibleDuplicates) out.push(`${x.possibleDuplicates} possible duplicate receipt${x.possibleDuplicates === 1 ? '' : 's'} need${x.possibleDuplicates === 1 ? 's' : ''} review.`);
  if (x.needsReview) out.push(`${x.needsReview} receipt${x.needsReview === 1 ? '' : 's'} waiting for review.`);
  if (x.overdueBills) out.push(`${x.overdueBills} bill${x.overdueBills === 1 ? ' is' : 's are'} overdue.`);
  if (x.newVendorsThisPeriod) out.push(`${x.newVendorsThisPeriod} new vendor${x.newVendorsThisPeriod === 1 ? '' : 's'} this period — review recommended.`);
  return out;
}
