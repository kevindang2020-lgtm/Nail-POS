// expense-digests.ts — the weekly and monthly owner summaries (mandate §178–§179) and the once-per-period rule (§177) as
// PURE functions. The money is summed by the report (expense.service.ts report(period)); this decides WHICH completed
// period is due, and turns the sums into the owner's two-line summary — wording the Owner App's alert feed shows.
//   weekly   "This Week — Expenses $4,820 · Receipts 23 · Needs review 2 · Bills due 3"
//   monthly  "October — Total $38,420 · Up 6.2% from September · Largest category Payroll · Largest vendor ABC Nail Supply"
// A summary covers a COMPLETED period (last Mon–Sun week, last calendar month) so its numbers never change after it is sent;
// the settings row remembers the period sent (weekly_summary_sent_for / monthly_summary_sent_for) so a restart, a second
// replica or an hourly tick never sends it twice.
import { addDays, isYmd } from '@aipowersalon/date-time';

export const dollars = (cents: number) => `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The Monday that starts the most recently COMPLETED Mon–Sun week before `today`. */
export function lastCompletedWeekMonday(today: string): string {
  if (!isYmd(today)) throw new Error('today must be YYYY-MM-DD');
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;   // Monday = 0
  return addDays(addDays(today, -dow), -7);
}
/** The most recently COMPLETED calendar month before `today`, as YYYY-MM. */
export function lastCompletedMonth(today: string): string {
  if (!isYmd(today)) throw new Error('today must be YYYY-MM-DD');
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
export function monthWindow(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
}
export const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/** Which digests are due now: a completed period the salon has not been sent yet (and the owner wants). */
export function digestsDue(today: string, prefs: { weekly: boolean; monthly: boolean; weeklySentFor: string | null; monthlySentFor: string | null }): { weekly: string | null; monthly: string | null } {
  const week = lastCompletedWeekMonday(today), month = lastCompletedMonth(today);
  return { weekly: prefs.weekly && prefs.weeklySentFor !== week ? week : null, monthly: prefs.monthly && prefs.monthlySentFor !== month ? month : null };
}

export interface WeeklyFacts { from: string; to: string; totalCents: number; receipts: number; needsReview: number; billsDue: number }
export function weeklySummary(f: WeeklyFacts): { title: string; body: string } {
  return { title: 'Weekly expense summary', body: `Week of ${f.from}: Expenses ${dollars(f.totalCents)} · Receipts ${f.receipts} · Needs review ${f.needsReview} · Bills due ${f.billsDue}.` };
}

export interface MonthlyFacts { month: string; totalCents: number; previousTotalCents: number; changePct: number | null; largestCategory: string | null; largestVendor: string | null }
export function monthlySummary(f: MonthlyFacts): { title: string; body: string } {
  const prev = lastCompletedMonth(`${f.month}-15`);
  const change = f.changePct == null ? (f.previousTotalCents === 0 && f.totalCents > 0 ? `No expenses in ${monthLabel(prev).split(' ')[0]}` : 'Same as last month')
    : f.changePct === 0 ? `Same as ${monthLabel(prev).split(' ')[0]}` : `${f.changePct > 0 ? 'Up' : 'Down'} ${Math.abs(f.changePct).toFixed(1)}% from ${monthLabel(prev).split(' ')[0]}`;
  const parts = [`Total expenses ${dollars(f.totalCents)}`, change];
  if (f.largestCategory) parts.push(`Largest category ${f.largestCategory}`);
  if (f.largestVendor) parts.push(`Largest vendor ${f.largestVendor}`);
  return { title: `${monthLabel(f.month)} expense summary`, body: `${parts.join(' · ')}.` };
}
