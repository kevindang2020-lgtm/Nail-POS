import type { OwnerAiQueueSummary } from '../api/ownerAiQueueApi';

// aiQueueSummaryCsv.ts — BUILD_PLAN Phase 6 (ai_queue_assignment): the Owner App's AI-queue branch comparison as CSV
// ("branch comparison + export"). Pure + unit-tested. A branch name is user-entered text, so a value that starts with
// = + - @ (or a tab / carriage return) is prefixed with ' — a spreadsheet must never run it as a formula.
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** acceptance as a whole percent (the API sends a 0–1 share); blank when there were no decisions */
const pct = (r: number | null | undefined) => (r == null ? '' : String(Math.round(r * 100)));

export function buildAiQueueSummaryCsv(data: Pick<OwnerAiQueueSummary, 'branches'> & { totals?: OwnerAiQueueSummary['totals'] }, days: number): string {
  const L: string[] = [];
  L.push(`AI queue assignment — branch comparison,last ${days} day(s)`);
  L.push('Branch,Served,Average wait (min),Longest wait (min),Acceptance (%),Staff decisions,Auto-assigned,Open alerts');
  for (const b of data.branches) L.push([cell(b.name), cell(b.served), cell(b.avgWaitMinutes), cell(b.longestWaitMinutes), pct(b.acceptanceRate), cell(b.staffDecisions), cell(b.autoAssigned), cell(b.openAlerts)].join(','));
  const t = data.totals;
  if (t) L.push(['All branches', cell(t.served), cell(t.avgWaitMinutes), cell(t.longestWaitMinutes), pct(t.acceptanceRate), cell(t.staffDecisions), cell(t.autoAssigned), cell(t.openAlerts)].join(','));
  return L.join('\n');
}
