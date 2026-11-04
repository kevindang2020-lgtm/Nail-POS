// deposit-reconciliation.exceptions.repository.ts — persistence for reconciliation exception cases. Tenant-scoped
// everywhere. In-memory adapter for tests; Kysely raw sql for production against reconciliation_exceptions.
import { canMoveToSql } from '@aipowersalon/database';
import { RECONCILIATION_EXCEPTION } from '../payments-lifecycles';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReconContext } from './deposit-reconciliation.dto';
import type { ReconException, ExceptionKind, ExceptionSeverity, ExceptionStatus } from './deposit-reconciliation.exceptions';

export interface CreateExceptionInput {
  kind: ExceptionKind; severity: ExceptionSeverity; title: string; detail?: string | null;
  amountCents?: number; currency?: string; sourceRef?: string | null; branchId?: string | null;
}
export interface UpdateExceptionPatch {
  status?: ExceptionStatus; assignedToUserId?: string | null; resolutionNote?: string | null;
  resolvedByUserId?: string | null; resolvedAt?: string | null; severity?: ExceptionSeverity;
}

export interface ExceptionsRepositoryPort {
  list(ctx: ReconContext, status?: string): Promise<ReconException[]>;
  create(ctx: ReconContext, input: CreateExceptionInput): Promise<ReconException>;
  find(ctx: ReconContext, id: string): Promise<ReconException | null>;
  update(ctx: ReconContext, id: string, patch: UpdateExceptionPatch): Promise<ReconException | null>;
  /** Optional (database): an active user of THIS salon — a case is never assigned to another salon's user */
  userInSalon?(ctx: ReconContext, userId: string): Promise<boolean>;
}

const iso = (v: any): string => (v == null ? '' : (typeof v === 'string' ? v : new Date(v).toISOString()));
const toDomain = (r: any): ReconException => ({
  id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, kind: String(r.kind) as ExceptionKind,
  severity: String(r.severity) as ExceptionSeverity, title: String(r.title), detail: r.detail ?? null,
  amountCents: Number(r.amount_cents || 0), currency: String(r.currency || 'USD'), status: String(r.status) as ExceptionStatus,
  sourceRef: r.source_ref ?? null, assignedToUserId: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null,
  resolutionNote: r.resolution_note ?? null, resolvedByUserId: r.resolved_by_user_id ? String(r.resolved_by_user_id) : null,
  resolvedAt: r.resolved_at ? iso(r.resolved_at) : null, createdAt: iso(r.created_at),
});

export class InMemoryExceptionsRepository implements ExceptionsRepositoryPort {
  private rows: (ReconException & { tenantId: string })[] = [];
  constructor(seed: (ReconException & { tenantId: string })[] = []) { this.rows = seed.slice(); }
  async list(ctx: ReconContext, status?: string): Promise<ReconException[]> {
    return this.rows.filter((r) => r.tenantId === ctx.tenantId && (!status || r.status === status)).map(({ tenantId, ...rest }) => rest);
  }
  async create(ctx: ReconContext, i: CreateExceptionInput): Promise<ReconException> {
    const row = { tenantId: ctx.tenantId, id: 'exc_' + (this.rows.length + 1), branchId: i.branchId ?? null, kind: i.kind, severity: i.severity, title: i.title, detail: i.detail ?? null, amountCents: i.amountCents ?? 0, currency: i.currency || 'USD', status: 'open' as ExceptionStatus, sourceRef: i.sourceRef ?? null, assignedToUserId: null, resolutionNote: null, resolvedByUserId: null, resolvedAt: null, createdAt: new Date().toISOString() };
    this.rows.push(row); const { tenantId, ...rest } = row; return rest;
  }
  async find(ctx: ReconContext, id: string): Promise<ReconException | null> {
    const r = this.rows.find((x) => x.tenantId === ctx.tenantId && x.id === id); if (!r) return null; const { tenantId, ...rest } = r; return rest;
  }
  async update(ctx: ReconContext, id: string, patch: UpdateExceptionPatch): Promise<ReconException | null> {
    const r = this.rows.find((x) => x.tenantId === ctx.tenantId && x.id === id); if (!r) return null;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.assignedToUserId !== undefined) r.assignedToUserId = patch.assignedToUserId;
    if (patch.resolutionNote !== undefined) r.resolutionNote = patch.resolutionNote;
    if (patch.resolvedByUserId !== undefined) r.resolvedByUserId = patch.resolvedByUserId;
    if (patch.resolvedAt !== undefined) r.resolvedAt = patch.resolvedAt;
    if (patch.severity !== undefined) r.severity = patch.severity;
    const { tenantId, ...rest } = r; return rest;
  }
}

export class KyselyExceptionsRepository implements ExceptionsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async list(ctx: ReconContext, status?: string): Promise<ReconException[]> {
    const res: any = status
      ? await sql`SELECT * FROM reconciliation_exceptions WHERE tenant_id = ${ctx.tenantId} AND status = ${status} ORDER BY created_at DESC LIMIT 1000`.execute(this.db).catch(() => ({ rows: [] }))
      : await sql`SELECT * FROM reconciliation_exceptions WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at DESC LIMIT 1000`.execute(this.db).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(toDomain);
  }
  async create(ctx: ReconContext, i: CreateExceptionInput): Promise<ReconException> {
    const res: any = await sql`
      INSERT INTO reconciliation_exceptions (tenant_id, branch_id, kind, severity, title, detail, amount_cents, currency, source_ref, created_by_user_id)
      VALUES (${ctx.tenantId}, ${i.branchId ?? null}, ${i.kind}, ${i.severity}, ${i.title}, ${i.detail ?? null}, ${i.amountCents ?? 0}, ${i.currency || 'USD'}, ${i.sourceRef ?? null}, ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(ctx.userId ?? '')) ? ctx.userId : null})   -- B-14: a system job (system:<job>) is not a user
      RETURNING *
    `.execute(this.db);
    return toDomain(res.rows[0]);
  }
  async userInSalon(ctx: ReconContext, userId: string): Promise<boolean> {
    return ((await sql`SELECT 1 FROM users WHERE tenant_id = ${ctx.tenantId} AND id = ${userId}::uuid LIMIT 1`.execute(this.db)).rows as unknown[]).length > 0;
  }
  async find(ctx: ReconContext, id: string): Promise<ReconException | null> {
    const res: any = await sql`SELECT * FROM reconciliation_exceptions WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? toDomain(res.rows[0]) : null;
  }
  async update(ctx: ReconContext, id: string, patch: UpdateExceptionPatch): Promise<ReconException | null> {
    const res: any = await sql`
      UPDATE reconciliation_exceptions SET
        status = COALESCE(${patch.status ?? null}, status),
        assigned_to_user_id = ${patch.assignedToUserId !== undefined ? patch.assignedToUserId : sql`assigned_to_user_id`},
        resolution_note = ${patch.resolutionNote !== undefined ? patch.resolutionNote : sql`resolution_note`},
        resolved_by_user_id = ${patch.resolvedByUserId !== undefined ? patch.resolvedByUserId : sql`resolved_by_user_id`},
        resolved_at = ${patch.resolvedAt !== undefined ? patch.resolvedAt : sql`resolved_at`},
        severity = COALESCE(${patch.severity ?? null}, severity),
        updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id} ${patch.status ? sql`AND ${canMoveToSql(RECONCILIATION_EXCEPTION, patch.status)}` : sql``}
      RETURNING *
    `.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? toDomain(res.rows[0]) : null;
  }
}
