import type { WorkflowStat, WorkflowKey } from '@aipowersalon/api-contracts/tenant';
export type { WorkflowStat, WorkflowKey };   // owned by packages/api-contracts (Constitution 13 §13)
export type RunStatus = 'sent' | 'failed' | 'skipped' | 'queued';

export interface WorkflowRunInput {
  tenantId: string; branchId?: string | null; workflowKey: WorkflowKey; dedupeKey: string;
  status?: RunStatus; customerId?: string | null; appointmentId?: string | null; detail?: string | null; ranAt?: string;
}
export interface WorkflowRunRow extends WorkflowRunInput { id: string; status: RunStatus; ranAt: string }


const sameDay = (iso: string, now: Date) => new Date(iso).toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
const within = (iso: string, days: number, now: Date) => (now.getTime() - new Date(iso).getTime()) <= days * 86400000;

export function summarizeRuns(rows: WorkflowRunRow[], now: Date = new Date()): Record<string, WorkflowStat> {
  const out: Record<string, WorkflowStat> = {};
  for (const r of rows) {
    const k = r.workflowKey;
    out[k] ??= { key: k, sentToday: 0, successRatePct: null };
  }
  for (const k of Object.keys(out)) {
    const krows = rows.filter((r) => r.workflowKey === k);
    out[k].sentToday = krows.filter((r) => sameDay(r.ranAt, now) && r.status === 'sent').length;
    const week = krows.filter((r) => within(r.ranAt, 7, now));
    const attempts = week.filter((r) => r.status === 'sent' || r.status === 'failed').length;
    out[k].successRatePct = attempts > 0 ? Math.round((week.filter((r) => r.status === 'sent').length / attempts) * 1000) / 10 : null;
  }
  return out;
}
