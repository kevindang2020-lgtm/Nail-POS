// deposit-reconciliation.reports.ts — PURE finance-report builders that compose the deterministic outputs of the
// earlier slices (reconciliation state, fee state, exceptions) into tenant-scoped report rows, plus a safe CSV
// serializer. No new data — these are views over what the engine already computed.
import type { ReconState, ReconRow } from './deposit-reconciliation.dto';
import type { FeeReconState } from './deposit-reconciliation.fees';
import type { ExceptionsState } from './deposit-reconciliation.exceptions';

export interface DailyReportRow {
  date: string;
  settlementCount: number;
  expectedCents: number;
  actualCents: number;
  differenceCents: number;
  matched: number;
  missing: number;
  unmatched: number;
}
export interface DailyReport { rows: DailyReportRow[]; totals: Omit<DailyReportRow, 'date'> }

const dateOf = (iso: string | null): string => (iso ? String(iso).slice(0, 10) : 'unknown');

export function buildDailyReport(recon: ReconState): DailyReport {
  const byDate = new Map<string, ReconRow[]>();
  for (const r of recon.rows) { const d = dateOf(r.settledAt); (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(r); }
  const rows: DailyReportRow[] = [...byDate.entries()].map(([date, rs]) => ({
    date,
    settlementCount: rs.length,
    expectedCents: rs.reduce((a, r) => a + r.expectedNetCents, 0),
    actualCents: rs.reduce((a, r) => a + (r.actualCents || 0), 0),
    differenceCents: rs.reduce((a, r) => a + Math.abs(r.differenceCents), 0),
    matched: rs.filter((r) => r.status === 'matched' || r.status === 'matched_with_tolerance').length,
    missing: rs.filter((r) => r.status === 'missing_deposit').length,
    unmatched: rs.filter((r) => r.status === 'unmatched_settlement').length,
  })).sort((a, b) => b.date.localeCompare(a.date));
  const totals = {
    settlementCount: rows.reduce((a, r) => a + r.settlementCount, 0),
    expectedCents: rows.reduce((a, r) => a + r.expectedCents, 0),
    actualCents: rows.reduce((a, r) => a + r.actualCents, 0),
    differenceCents: rows.reduce((a, r) => a + r.differenceCents, 0),
    matched: rows.reduce((a, r) => a + r.matched, 0),
    missing: rows.reduce((a, r) => a + r.missing, 0),
    unmatched: rows.reduce((a, r) => a + r.unmatched, 0),
  };
  return { rows, totals };
}

export interface ReconSummary {
  settlements: number; expectedCents: number; actualMatchedCents: number;
  matched: number; matchedWithTolerance: number; missingDeposits: number; unmatchedSettlements: number;
  feeMatched: number; feeDifferences: number; feeUnverified: number;
  openExceptions: number; criticalExceptions: number; amountAtRiskCents: number;
}
export function buildSummary(recon: ReconState, fees: FeeReconState, exceptions: ExceptionsState): ReconSummary {
  return {
    settlements: recon.kpis.settlementCount,
    expectedCents: recon.kpis.expectedCents,
    actualMatchedCents: recon.kpis.actualMatchedCents,
    matched: recon.kpis.matched,
    matchedWithTolerance: recon.kpis.matchedWithTolerance,
    missingDeposits: recon.kpis.missingDeposits,
    unmatchedSettlements: recon.kpis.unmatchedSettlements,
    feeMatched: fees.kpis.matched,
    feeDifferences: fees.kpis.feeDifferences,
    feeUnverified: fees.kpis.unverified,
    openExceptions: exceptions.kpis.open + exceptions.kpis.inReview + exceptions.kpis.escalated,
    criticalExceptions: exceptions.kpis.critical,
    amountAtRiskCents: exceptions.kpis.amountAtRiskCents,
  };
}

// Safe CSV: quotes fields, escapes embedded quotes, prevents CSV formula injection (leading =,+,-,@).
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null): string => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;         // neutralize spreadsheet formula injection
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return [headers.map(cell).join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

export function dailyReportToCsv(report: DailyReport): string {
  const headers = ['Date', 'Settlements', 'Expected', 'Actual', 'Difference', 'Matched', 'Missing', 'Unmatched'];
  const fmt = (c: number) => (c / 100).toFixed(2);
  const rows = report.rows.map((r) => [r.date, r.settlementCount, fmt(r.expectedCents), fmt(r.actualCents), fmt(r.differenceCents), r.matched, r.missing, r.unmatched]);
  rows.push(['TOTAL', report.totals.settlementCount, fmt(report.totals.expectedCents), fmt(report.totals.actualCents), fmt(report.totals.differenceCents), report.totals.matched, report.totals.missing, report.totals.unmatched]);
  return toCsv(headers, rows);
}
