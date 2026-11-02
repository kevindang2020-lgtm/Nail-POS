import type { AttemptReport, ReportPeriod } from '@aipowersalon/api-contracts/tenant';
export type { AttemptReport, ReportPeriod };   // owned by packages/api-contracts (Constitution 13 §13)
import { businessDate, dayStartMs } from '@aipowersalon/date-time';
// mobile-report.ts — pure aggregation for the Payment App's Reports tab. Honest by construction: it reports payment
// ATTEMPTS and their outcomes, and separates the total ATTEMPTED from the total SETTLED. Only a 'confirmed' attempt
// counts as settled, so settledTotalCents stays 0 until a real capture confirms — this build never inflates it.


export interface AttemptReportInput { status: string; amountCents: number; createdAt: string }


const SETTLED_STATES = new Set(['confirmed']);

// "Today" and the daily buckets are the BRANCH's day (`tz`), not the server's UTC one (Oct 6 2026): after 8 pm in New York
// the Reports tab's "today" was empty and the evening's attempts sat under tomorrow's date.
function sinceFor(period: ReportPeriod, now: Date, tz: string): Date {
  if (period === 'today') return new Date(dayStartMs(tz, now));
  const days = period === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function dateKey(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : businessDate(tz, d);
}

export function computeReport(attempts: AttemptReportInput[], period: ReportPeriod, now: Date = new Date(), tz = 'UTC'): AttemptReport {
  const since = sinceFor(period, now, tz).getTime();
  const inWindow = attempts.filter((a) => {
    const t = new Date(a.createdAt).getTime();
    return !Number.isNaN(t) && t >= since;
  });

  const byStatus: Record<string, number> = {};
  const dayMap = new Map<string, { count: number; attemptedCents: number }>();
  let attemptedTotalCents = 0;
  let settledTotalCents = 0;

  for (const a of inWindow) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    attemptedTotalCents += a.amountCents;
    if (SETTLED_STATES.has(a.status)) settledTotalCents += a.amountCents;
    const k = dateKey(a.createdAt, tz);
    const bucket = dayMap.get(k) || { count: 0, attemptedCents: 0 };
    bucket.count += 1; bucket.attemptedCents += a.amountCents;
    dayMap.set(k, bucket);
  }

  const daily = [...dayMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { period, totalAttempts: inWindow.length, byStatus, attemptedTotalCents, settledTotalCents, daily };
}
