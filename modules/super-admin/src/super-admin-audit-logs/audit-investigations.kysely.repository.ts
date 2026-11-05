// audit-investigations.kysely.repository.ts — case register + append-only timeline. Timeline rows are only ever
// inserted (never updated/deleted). Only the case's status/updated_at are mutable; each change also appends a
// status_change timeline entry. Reads/writes never touch audit_events destructively.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { AUDIT_INVESTIGATION } from '../lifecycles';

export interface InvestigationRow { id: string; case_ref: string; title: string; tenant_id: string | null; severity: string; assignee: string | null; status: string; description: string | null; created_at: string; updated_at: string }
export interface TimelineRow { id: string; entry_type: string; payload: any; author: string | null; created_at: string }
const COLS = sql`id::text as id, case_ref, title, tenant_id::text as tenant_id, severity, assignee, status, description, created_at::text as created_at, updated_at::text as updated_at`;
const OPEN_STATES = ['open', 'in_progress', 'waiting', 'escalated', 'reopened'];

export class AuditInvestigationsRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(status?: string): Promise<InvestigationRow[]> {
    try {
      const q = status === 'open'
        ? sql`select ${COLS} from audit_investigations where status = any(${OPEN_STATES}) order by created_at desc`
        : status
          ? sql`select ${COLS} from audit_investigations where status = ${status} order by created_at desc`
          : sql`select ${COLS} from audit_investigations order by created_at desc`;
      return (await q.execute(this.db as any)).rows as InvestigationRow[];
    } catch { return []; }
  }
  async get(id: string): Promise<InvestigationRow | null> {
    const r = (await sql`select ${COLS} from audit_investigations where id = ${id} limit 1`.execute(this.db as any)).rows[0] as InvestigationRow | undefined;
    return r ?? null;
  }
  async timeline(id: string): Promise<TimelineRow[]> {
    return (await sql`select id::text as id, entry_type, payload, author, created_at::text as created_at from audit_investigation_timeline where investigation_id = ${id} order by created_at asc, id asc`.execute(this.db as any)).rows as TimelineRow[];
  }
  async countOpen(): Promise<number> {
    try { const r = (await sql`select count(*)::int as c from audit_investigations where status = any(${OPEN_STATES})`.execute(this.db as any)).rows[0] as { c: number }; return r?.c ?? 0; } catch { return 0; }
  }
  async recentOpen(limit = 6): Promise<InvestigationRow[]> {
    return (await sql`select ${COLS} from audit_investigations where status = any(${OPEN_STATES}) order by created_at desc limit ${limit}`.execute(this.db as any)).rows as InvestigationRow[];
  }

  async insert(i: { caseRef: string; title: string; tenantId: string | null; severity: string; assignee: string | null; description: string | null; createdBy: string | null }): Promise<InvestigationRow> {
    const row = (await sql`insert into audit_investigations (case_ref, title, tenant_id, severity, assignee, description, created_by)
      values (${i.caseRef}, ${i.title}, ${i.tenantId}, ${i.severity}, ${i.assignee}, ${i.description}, ${i.createdBy}) returning ${COLS}`.execute(this.db as any)).rows[0] as InvestigationRow;
    await this.appendTimeline(row.id, 'created', { title: i.title, severity: i.severity }, i.assignee);
    return row;
  }
  async appendTimeline(investigationId: string, entryType: string, payload: unknown, author: string | null): Promise<void> {
    await sql`insert into audit_investigation_timeline (investigation_id, entry_type, payload, author) values (${investigationId}, ${entryType}, ${JSON.stringify(payload ?? {})}::jsonb, ${author})`.execute(this.db as any);
  }
  async setStatus(id: string, status: string): Promise<void> {
    await sql`update audit_investigations set status = ${status}, updated_at = now() where id = ${id} and ${canMoveToSql(AUDIT_INVESTIGATION, status)}`.execute(this.db as any);
  }
  get openStates() { return OPEN_STATES; }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    if (!tenantId) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'audit-logs', ${action}, 'investigation', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
