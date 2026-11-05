// ai-scheduling-export.ts — BUILD_PLAN Phase 7 (agent B): CSV export of the optimizer's history.
//   GET pos/ai-scheduling-optimizer/export?kind=recommendations|runs|insights&from&to (ai_scheduling.export) → text/csv
// Tenant-scoped (and location-scoped for a location session). No customer names or phones — ids and computed facts only.
// Every cell is CSV-quoted when needed, and a cell that a spreadsheet would run as a formula (= + - @ tab CR) is prefixed
// with an apostrophe (CSV injection).
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import type { SchedCtx } from './ai-scheduling.ports';
import { SchedOpsError, addDaysYmd, iso, isYmd, needPerm, rowsOf } from './ai-scheduling-ops.common';

export const EXPORT_KINDS = ['recommendations', 'runs', 'insights'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const MAX_EXPORT_ROWS = 10_000;

/** One CSV cell: formula-leading text neutralised, then RFC 4180 quoting. */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string { return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

export interface ExportRead { rows(kind: ExportKind, tenantId: string, branchId: string | null, fromIso: string, toIso: string, limit: number): Promise<{ header: string[]; rows: unknown[][] }> }

export class KyselyExportRead implements ExportRead {
  constructor(private readonly db: Kysely<any>) {}
  async rows(kind: ExportKind, tenantId: string, branchId: string | null, fromIso: string, toIso: string, limit: number) {
    const br = sql`(${branchId}::uuid is null or branch_id = ${branchId}::uuid)`;
    if (kind === 'runs') {
      const header = ['run_id', 'started_at', 'completed_at', 'branch_id', 'scope', 'status', 'trigger', 'run_date', 'technician_id', 'recommendations', 'gaps', 'conflicts', 'latency_ms', 'error_code'];
      const rs = rowsOf(await sql`select * from schedule_optimization_runs where tenant_id = ${tenantId} and ${br} and started_at >= ${fromIso} and started_at < ${toIso} order by started_at desc limit ${limit}`.execute(this.db));
      return { header, rows: rs.map((r) => [r.id, iso(r.started_at), iso(r.completed_at), r.branch_id, r.scope, r.status, r.run_trigger, r.run_date ? iso(r.run_date)?.slice(0, 10) : null, r.technician_id, r.recommendation_count, r.gap_count, r.conflict_count, r.latency_ms, r.error_code]) };
    }
    if (kind === 'recommendations') {
      const header = ['recommendation_id', 'created_at', 'branch_id', 'run_id', 'type', 'status', 'appointment_id', 'from_date', 'from_time', 'to_date', 'to_time', 'to_technician_id', 'confidence', 'data_quality', 'requires_customer_approval', 'automated', 'decided_at', 'applied_at', 'explanation_source'];
      const rs = rowsOf(await sql`select * from schedule_optimization_recommendations where tenant_id = ${tenantId} and ${br} and created_at >= ${fromIso} and created_at < ${toIso} order by created_at desc limit ${limit}`.execute(this.db));
      return { header, rows: rs.map((r) => { const c = r.current_state || {}, p = r.proposed_state || {}; return [r.id, iso(r.created_at), r.branch_id, r.run_id, r.type, r.status, p.appointmentId ?? c.appointmentId ?? null, c.date ?? null, c.startTime ?? null, p.date ?? null, p.startTime ?? null, p.technicianId ?? null, r.confidence, r.data_quality, r.requires_customer_approval, r.automated, iso(r.decided_at), iso(r.applied_at), r.explanation_source]; }) };
    }
    const header = ['kind', 'insight_id', 'created_at', 'branch_id', 'status', 'date', 'service_id', 'technician_id', 'detail', 'confidence'];
    const d = rowsOf(await sql`select 'duration' as k, id, created_at, branch_id, status, null::date as date, service_id, technician_id, concat(action, ' ', current_min, '→', suggested_min, ' min (n=', sample_size, ')') as detail, confidence
                                 from service_duration_recommendations where tenant_id = ${tenantId} and ${br} and created_at >= ${fromIso} and created_at < ${toIso}
                               union all
                               select 'staffing', id, created_at, branch_id, status, date, null::uuid, null::uuid, concat(state, ' missing ', missing_minutes, ' min'), confidence
                                 from staffing_coverage_recommendations where tenant_id = ${tenantId} and ${br} and created_at >= ${fromIso} and created_at < ${toIso}
                               union all
                               select 'availability', id, created_at, branch_id, status, date, service_id, technician_id, concat(direction, ': ', reason), confidence
                                 from appointment_availability_recommendations where tenant_id = ${tenantId} and ${br} and created_at >= ${fromIso} and created_at < ${toIso}
                               order by created_at desc limit ${limit}`.execute(this.db));
    return { header, rows: d.map((r) => [r.k, r.id, iso(r.created_at), r.branch_id, r.status, r.date ? iso(r.date)?.slice(0, 10) : null, r.service_id, r.technician_id, r.detail, r.confidence]) };
  }
}

export class SchedExportService {
  constructor(private readonly read: ExportRead, private readonly now: () => number = Date.now) {}
  async export(ctx: SchedCtx, q: { kind?: string; from?: string; to?: string }): Promise<{ filename: string; csv: string; rows: number }> {
    needPerm(ctx, 'ai_scheduling.export');
    const kind = EXPORT_KINDS.find((k) => k === q.kind);
    if (!kind) throw new SchedOpsError('VALIDATION', 'kind must be recommendations, runs or insights.');
    const to = q.to || utcDate(new Date(this.now()));   // the UTC calendar day: the range filters UTC instants
    const from = q.from || addDaysYmd(to, -29);
    if (!isYmd(from) || !isYmd(to) || from > to) throw new SchedOpsError('VALIDATION', 'from / to must be dates (YYYY-MM-DD) with from ≤ to.');
    const out = await this.read.rows(kind, ctx.tenantId, ctx.branchId ?? null, `${from}T00:00:00.000Z`, `${addDaysYmd(to, 1)}T00:00:00.000Z`, MAX_EXPORT_ROWS);
    return { filename: `ai-scheduling-${kind}-${from}-to-${to}.csv`, csv: toCsv(out.header, out.rows), rows: out.rows.length };
  }
}
