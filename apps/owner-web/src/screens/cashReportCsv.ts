import type { DailyCashSummary, OwnerDrawerRow, OwnerCashHandoffRow } from '../api/ownerApi';

// Builds the end-of-day cash close-out as CSV: total position + per-branch register lines + per-technician cash lines.
// Amounts are plain dollars (cents/100, 2dp) so the file imports cleanly into Excel / QuickBooks. Pure + unit-tested.
const d = (c: number | null | undefined) => ((c || 0) / 100).toFixed(2);
const esc = (s: any) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

export function buildCashReportCsv(summary: DailyCashSummary, branches: OwnerDrawerRow[], techs: OwnerCashHandoffRow[]): string {
  const L: string[] = [];
  L.push('AIPowerSalon — Daily Cash Close-Out');
  L.push(`Date,${summary.businessDate}`);
  L.push('');
  L.push('TOTAL CASH POSITION');
  L.push('Pool,Expected,Counted,Variance');
  L.push(`Total,${d(summary.total.expectedCents)},${d(summary.total.countedCents)},${d(summary.total.varianceCents)}`);
  L.push(`Register drawer,${d(summary.register.expectedCents)},${d(summary.register.countedCents)},${d(summary.register.varianceCents)}`);
  L.push(`Technician cash,${d(summary.techCash.expectedCents)},${d(summary.techCash.countedCents)},${d(summary.techCash.varianceCents)}`);
  L.push('');
  L.push('REGISTER DRAWER (by branch)');
  L.push('Branch,Float,Sales,Refunds,Cash In,Cash Out,Expected,Counted,Variance,Status');
  for (const b of branches) {
    L.push([esc(b.branchName), d(b.openingFloatCents), d(b.expectedSalesCents), d(b.refundsCents), d(b.paidInCents), d(b.paidOutCents), d(b.expectedCashCents), b.countedCents == null ? '' : d(b.countedCents), b.varianceCents == null ? '' : d(b.varianceCents), b.status].join(','));
  }
  L.push('');
  L.push('TECHNICIAN CASH (by technician)');
  L.push('Technician,Expected,Counted,Variance,Status');
  for (const t of techs) {
    L.push([esc(t.technicianName), d(t.expectedCents), t.countedCents == null ? '' : d(t.countedCents), t.varianceCents == null ? '' : d(t.varianceCents), t.status].join(','));
  }
  return L.join('\n');
}
