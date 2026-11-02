// ai-queue-assignment-ops.repository.ts — BUILD_PLAN Phase 6: the read model behind the AI queue analytics, exports,
// overview, usage and the owner's branch comparison. READ-ONLY. Every statement is scoped `tenant_id = ${tenantId}`
// (and the branch when the caller is a branch). Served waits come from pos_queue_items' own check-in / start stamps
// (the record the boards show); the status history is agent A's pos_queue_status_history (migration 524).
// No guest names or phones are selected — nothing here can put customer data into an export or a chart.
import { sql, type Kysely } from 'kysely';
import type { DecisionLike, ServedWait } from './ai-queue-assignment-analytics';

export interface DecisionRow extends DecisionLike {
  id: string; branchId: string; queueEntryId: string; previousTechnicianId: string | null; decidedBy: string | null; applied: boolean; feedbackCode: string | null;
}
export interface HistoryRow {
  queueItemId: string; branchId: string; version: number; action: string; source: string; fromStatus: string | null; toStatus: string;
  fromTechnicianId: string | null; toTechnicianId: string | null; actorId: string | null; reason: string | null; createdAt: string;
}
export interface AlertExportRow { id: string; branchId: string; type: string; severity: string; status: string; queueEntryId: string; technicianId: string | null; reason: string; autoResolved: boolean; resolution: string | null; createdAt: string; resolvedAt: string | null }
export interface BranchInfo { branchId: string; name: string; timezone: string | null }
export interface UsageSummary { byStatus: Record<string, number>; byAction: Record<string, number>; calls: number; costMicroUsd: number; recommendations: number }

export interface QueueOpsReadPort {
  decisions(tenantId: string, branchId: string | null, from: string, to: string, limit?: number): Promise<DecisionRow[]>;
  servedWaits(tenantId: string, branchId: string | null, from: string, to: string): Promise<(ServedWait & { branchId: string })[]>;
  alerts(tenantId: string, branchId: string | null, from: string, to: string): Promise<AlertExportRow[]>;
  history(tenantId: string, branchId: string | null, from: string, to: string, limit?: number): Promise<HistoryRow[]>;
  technicianNames(tenantId: string): Promise<Record<string, string>>;
  branches(tenantId: string): Promise<BranchInfo[]>;
  openAlertCounts(tenantId: string): Promise<Record<string, number>>;
  usage(tenantId: string, from: string, to: string): Promise<UsageSummary>;
  runStamps(tenantId: string, branchId: string): Promise<{ lastScanAt: string | null; lastAutoRunAt: string | null }>;
}

const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());
const s = (v: unknown): string | null => (v == null ? null : String(v));
const MAX = 20_000;

export class KyselyQueueOpsRead implements QueueOpsReadPort {
  constructor(private readonly db: Kysely<any>) {}
  private branchPred(col: string, branchId: string | null) { return branchId ? sql`and ${sql.ref(col)} = ${branchId}` : sql``; }

  async decisions(tenantId: string, branchId: string | null, from: string, to: string, limit = MAX): Promise<DecisionRow[]> {
    const r = await sql`select id, branch_id, queue_entry_id, decision, chosen_technician, previous_technician, reason, feedback_code, decided_by, applied, created_at
                        from queue_assignment_decisions where tenant_id = ${tenantId} ${this.branchPred('branch_id', branchId)}
                          and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz order by created_at limit ${Math.min(MAX, limit)}`.execute(this.db);
    return (r.rows as any[]).map((x) => ({ id: String(x.id), branchId: String(x.branch_id), queueEntryId: String(x.queue_entry_id), decision: x.decision, chosenTechnicianId: s(x.chosen_technician),
      previousTechnicianId: s(x.previous_technician), reason: x.reason ?? null, feedbackCode: x.feedback_code ?? null, decidedBy: s(x.decided_by), applied: !!x.applied, createdAt: iso(x.created_at)! }));
  }
  async servedWaits(tenantId: string, branchId: string | null, from: string, to: string) {
    const r = await sql`select id, branch_id, assigned_technician_id, checked_in_at, started_at from pos_queue_items
                        where tenant_id = ${tenantId} ${this.branchPred('branch_id', branchId)} and started_at is not null
                          and started_at >= ${from}::timestamptz and started_at < ${to}::timestamptz limit ${MAX}`.execute(this.db);
    return (r.rows as any[]).map((x) => ({ queueItemId: String(x.id), branchId: String(x.branch_id), technicianId: s(x.assigned_technician_id), checkedInAt: iso(x.checked_in_at)!, startedAt: iso(x.started_at)! }));
  }
  async alerts(tenantId: string, branchId: string | null, from: string, to: string): Promise<AlertExportRow[]> {
    const r = await sql`select id, branch_id, type, severity, status, queue_entry_id, technician_id, reason, auto_resolved, resolution, created_at, resolved_at from queue_alerts
                        where tenant_id = ${tenantId} ${this.branchPred('branch_id', branchId)} and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
                        order by created_at limit ${MAX}`.execute(this.db);
    return (r.rows as any[]).map((x) => ({ id: String(x.id), branchId: String(x.branch_id), type: x.type, severity: x.severity, status: x.status, queueEntryId: String(x.queue_entry_id),
      technicianId: s(x.technician_id), reason: x.reason, autoResolved: !!x.auto_resolved, resolution: x.resolution ?? null, createdAt: iso(x.created_at)!, resolvedAt: iso(x.resolved_at) }));
  }
  async history(tenantId: string, branchId: string | null, from: string, to: string, limit = MAX): Promise<HistoryRow[]> {
    const r = await sql`select queue_item_id, branch_id, version, action, source, from_status, to_status, from_technician, to_technician, actor_id, reason, created_at
                        from pos_queue_status_history where tenant_id = ${tenantId} ${this.branchPred('branch_id', branchId)}
                          and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz order by created_at limit ${Math.min(MAX, limit)}`.execute(this.db);
    return (r.rows as any[]).map((x) => ({ queueItemId: String(x.queue_item_id), branchId: String(x.branch_id), version: Number(x.version), action: x.action, source: x.source, fromStatus: x.from_status ?? null,
      toStatus: x.to_status, fromTechnicianId: s(x.from_technician), toTechnicianId: s(x.to_technician), actorId: s(x.actor_id), reason: x.reason ?? null, createdAt: iso(x.created_at)! }));
  }
  async technicianNames(tenantId: string): Promise<Record<string, string>> {
    const r = await sql`select id, full_name, first_name, last_name from technicians where tenant_id = ${tenantId}`.execute(this.db).catch(() => ({ rows: [] }));
    const out: Record<string, string> = {};
    for (const x of r.rows as any[]) out[String(x.id)] = String(x.full_name || [x.first_name, x.last_name].filter(Boolean).join(' ') || 'Technician');
    return out;
  }
  async branches(tenantId: string): Promise<BranchInfo[]> {
    const r = await sql`select id, name, timezone from branches where tenant_id = ${tenantId} and status = 'active' and deleted_at is null order by name`.execute(this.db);
    return (r.rows as any[]).map((x) => ({ branchId: String(x.id), name: String(x.name), timezone: x.timezone ?? null }));
  }
  async openAlertCounts(tenantId: string): Promise<Record<string, number>> {
    const r = await sql`select branch_id, count(*)::int as n from queue_alerts where tenant_id = ${tenantId} and status <> 'resolved' group by branch_id`.execute(this.db);
    const out: Record<string, number> = {}; for (const x of r.rows as any[]) out[String(x.branch_id)] = Number(x.n); return out;
  }
  async usage(tenantId: string, from: string, to: string): Promise<UsageSummary> {
    const u = await sql`select action, status, count(*)::int as n, coalesce(sum(cost_micro_usd), 0)::bigint as cost from ai_usage_logs
                        where tenant_id = ${tenantId} and package_code = 'ai_queue_technician_assignment' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
                        group by action, status`.execute(this.db);
    const byStatus: Record<string, number> = {}; const byAction: Record<string, number> = {}; let calls = 0; let cost = 0;
    for (const x of u.rows as any[]) { byStatus[x.status] = (byStatus[x.status] ?? 0) + Number(x.n); byAction[x.action] = (byAction[x.action] ?? 0) + Number(x.n); calls += Number(x.n); cost += Number(x.cost); }
    const rec = await sql`select count(*)::int as n from queue_assignment_recommendations where tenant_id = ${tenantId} and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz`.execute(this.db);
    return { byStatus, byAction, calls, costMicroUsd: cost, recommendations: Number((rec.rows as any[])[0]?.n ?? 0) };
  }
  async runStamps(tenantId: string, branchId: string) {
    const r = await sql`select last_scan_at, last_auto_run_at from queue_assignment_settings where tenant_id = ${tenantId} and branch_id = ${branchId}`.execute(this.db);
    const x: any = r.rows[0];
    return { lastScanAt: iso(x?.last_scan_at), lastAutoRunAt: iso(x?.last_auto_run_at) };
  }
}

/** Tests / DB-less. */
export class InMemoryQueueOpsRead implements QueueOpsReadPort {
  constructor(public data: { decisions?: DecisionRow[]; waits?: (ServedWait & { branchId: string })[]; alerts?: AlertExportRow[]; history?: HistoryRow[]; names?: Record<string, string>;
    branches?: BranchInfo[]; usage?: UsageSummary; tenantId?: string } = {}) {}
  private inRange(t: string, from: string, to: string) { return t >= from && t < to; }
  async decisions(_t: string, b: string | null, from: string, to: string) { return (this.data.decisions ?? []).filter((d) => (!b || d.branchId === b) && this.inRange(d.createdAt, from, to)); }
  async servedWaits(_t: string, b: string | null, from: string, to: string) { return (this.data.waits ?? []).filter((w) => (!b || w.branchId === b) && this.inRange(w.startedAt, from, to)); }
  async alerts(_t: string, b: string | null, from: string, to: string) { return (this.data.alerts ?? []).filter((a) => (!b || a.branchId === b) && this.inRange(a.createdAt, from, to)); }
  async history(_t: string, b: string | null, from: string, to: string) { return (this.data.history ?? []).filter((h) => (!b || h.branchId === b) && this.inRange(h.createdAt, from, to)); }
  async technicianNames() { return this.data.names ?? {}; }
  async branches() { return this.data.branches ?? []; }
  async openAlertCounts() { const o: Record<string, number> = {}; for (const a of this.data.alerts ?? []) if (a.status !== 'resolved') o[a.branchId] = (o[a.branchId] ?? 0) + 1; return o; }
  async usage() { return this.data.usage ?? { byStatus: {}, byAction: {}, calls: 0, costMicroUsd: 0, recommendations: 0 }; }
  async runStamps() { return { lastScanAt: null, lastAutoRunAt: null }; }
}
