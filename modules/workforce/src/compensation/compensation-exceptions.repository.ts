/**
 * compensation-exceptions.repository.ts — the FINANCIAL EXCEPTION QUEUE (Payroll mandate §196–§198, migration 612).
 * One row per (tenant, kind, dedupe_key): raising the same problem again refreshes the row (and re-opens a resolved one)
 * instead of writing a second. Status moves through COMPENSATION_EXCEPTION (workforce-lifecycles.ts). Never deleted —
 * an owner resolves or dismisses with a note (§125). Detail JSON carries ids and counts only, never personal data (§164).
 */
import { sql, type Kysely } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { COMPENSATION_EXCEPTION } from '../workforce-lifecycles';

export type ExceptionKind = 'missing_snapshot' | 'missing_technician' | 'unallocated_tip' | 'missing_rule' | 'refund_closed_period' | 'chargeback_review' | 'negative_pay' | 'invalid_data';
export const EXCEPTION_KINDS: readonly ExceptionKind[] = ['missing_snapshot', 'missing_technician', 'unallocated_tip', 'missing_rule', 'refund_closed_period', 'chargeback_review', 'negative_pay', 'invalid_data'];
export interface ExceptionRow {
  id: string; kind: ExceptionKind; severity: 'blocking' | 'warning'; status: 'open' | 'retrying' | 'resolved' | 'dismissed';
  ticketId: string | null; periodId: string | null; technicianId: string | null; attempts: number; lastError: string | null;
  nextAttemptAt: string | null; detail: Record<string, unknown> | null; resolutionNote: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
}
const iso = (v: unknown) => (v == null ? null : new Date(v as any).toISOString());
const COLS = ['id', 'kind', 'severity', 'status', 'ticket_id', 'period_id', 'technician_id', 'attempts', 'last_error', 'next_attempt_at', 'detail_json', 'resolution_note', 'resolved_at', 'created_at', 'updated_at'] as const;
const map = (r: any): ExceptionRow => ({
  id: r.id, kind: r.kind, severity: r.severity, status: r.status, ticketId: r.ticket_id ?? null, periodId: r.period_id ?? null, technicianId: r.technician_id ?? null,
  attempts: Number(r.attempts || 0), lastError: r.last_error ?? null, nextAttemptAt: iso(r.next_attempt_at),
  detail: (typeof r.detail_json === 'string' ? JSON.parse(r.detail_json) : r.detail_json) ?? null, resolutionNote: r.resolution_note ?? null,
  resolvedAt: iso(r.resolved_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});

export interface RaiseException { kind: ExceptionKind; severity: 'blocking' | 'warning'; dedupeKey: string; branchId?: string | null; ticketId?: string | null; periodId?: string | null; technicianId?: string | null; detail?: Record<string, unknown>; lastError?: string | null }

export class CompensationExceptionsRepository {
  constructor(private readonly db: Kysely<DB>) {}

  /** Raise / refresh. A row that was dismissed stays dismissed (the owner decided); a resolved one re-opens. */
  async raise(tenantId: string, e: RaiseException): Promise<void> {
    await this.db.insertInto('compensation_exceptions').values({
      tenant_id: tenantId, branch_id: e.branchId ?? null, kind: e.kind, severity: e.severity, dedupe_key: e.dedupeKey.slice(0, 200),
      ticket_id: e.ticketId ?? null, period_id: e.periodId ?? null, technician_id: e.technicianId ?? null,
      detail_json: e.detail ? JSON.stringify(e.detail) : null, last_error: e.lastError ? e.lastError.slice(0, 500) : null,
    }).onConflict((oc) => oc.columns(['tenant_id', 'kind', 'dedupe_key']).doUpdateSet({
      detail_json: e.detail ? JSON.stringify(e.detail) : null, updated_at: sql`now()`,
    }).where('compensation_exceptions.status', '<>', 'dismissed')).execute();
    // the problem is back: a RESOLVED row re-opens (through the machine — resolved → open); a dismissed one stays dismissed
    await this.db.updateTable('compensation_exceptions').set({ status: 'open', resolved_at: null, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('kind', '=', e.kind).where('dedupe_key', '=', e.dedupeKey.slice(0, 200)).where('status', '=', 'resolved')
      .where(canMoveToSql(COMPENSATION_EXCEPTION, 'open') as any).execute();
  }

  async list(tenantId: string, f: { status?: string; kind?: string; limit?: number } = {}): Promise<ExceptionRow[]> {
    let q = this.db.selectFrom('compensation_exceptions').select([...COLS]).where('tenant_id', '=', tenantId);
    if (f.status === 'open') q = q.where('status', 'in', ['open', 'retrying']);
    else if (f.status) q = q.where('status', '=', f.status);
    if (f.kind) q = q.where('kind', '=', f.kind);
    return (await q.orderBy('created_at', 'desc').limit(Math.min(200, Math.max(1, f.limit ?? 100))).execute()).map(map);
  }

  async get(tenantId: string, id: string): Promise<ExceptionRow | null> {
    const r = await this.db.selectFrom('compensation_exceptions').select([...COLS]).where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
    return r ? map(r) : null;
  }

  /** Owner / worker decision through the machine. Returns false when the row was not in a state that allows it. */
  async setStatus(tenantId: string, id: string, to: 'open' | 'retrying' | 'resolved' | 'dismissed', meta: { userId?: string | null; note?: string | null; lastError?: string | null; nextAttemptAt?: string | null; bumpAttempt?: boolean } = {}): Promise<boolean> {
    const set: Record<string, unknown> = { status: to, updated_at: sql`now()`, updated_by: meta.userId ?? null };
    if (to === 'resolved' || to === 'dismissed') { set.resolved_at = sql`now()`; set.resolved_by = meta.userId ?? null; set.resolution_note = meta.note ? meta.note.slice(0, 500) : null; }
    if (meta.lastError !== undefined) set.last_error = meta.lastError ? meta.lastError.slice(0, 500) : null;
    if (meta.nextAttemptAt !== undefined) set.next_attempt_at = meta.nextAttemptAt;
    if (meta.bumpAttempt) set.attempts = sql`attempts + 1`;
    const r = await this.db.updateTable('compensation_exceptions').set(set as any)
      .where('tenant_id', '=', tenantId).where('id', '=', id).where(canMoveToSql(COMPENSATION_EXCEPTION, to) as any).executeTakeFirst();
    return Number((r as any)?.numUpdatedRows ?? 0) > 0;
  }

  /** Resolve every open row of a kind + key (the worker fixed it, or the case closed). */
  async resolveByKey(tenantId: string, kind: ExceptionKind, dedupeKey: string, note: string): Promise<void> {
    await this.db.updateTable('compensation_exceptions').set({ status: 'resolved', resolved_at: sql`now()`, resolution_note: note, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', tenantId).where('kind', '=', kind).where('dedupe_key', '=', dedupeKey)
      .where(canMoveToSql(COMPENSATION_EXCEPTION, 'resolved') as any).execute();
  }

  /** Open / retrying counts per severity for a tenant (validation + the owner dashboard). */
  async openCounts(tenantId: string): Promise<{ kind: string; severity: 'blocking' | 'warning' }[]> {
    return (await this.db.selectFrom('compensation_exceptions').select(['kind', 'severity']).where('tenant_id', '=', tenantId).where('status', 'in', ['open', 'retrying']).limit(1000).execute()) as any;
  }
}
