// audit-legal-holds.kysely.repository.ts — persistence for the legal hold register. Reads/writes only the holds table;
// never touches audit_events (tamper-resistance). A tenant-scoped hold also records an audit_events row for itself.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { AUDIT_LEGAL_HOLD } from '../lifecycles';

export interface LegalHoldRow { id: string; hold_ref: string; scope_type: string; scope_value: string | null; reason: string; legal_authority: string | null; status: string; created_at: string; review_date: string | null; expiration_date: string | null; released_at: string | null; release_reason: string | null }
const COLS = sql`id::text as id, hold_ref, scope_type, scope_value, reason, legal_authority, status, created_at::text as created_at, review_date::text as review_date, expiration_date::text as expiration_date, released_at::text as released_at, release_reason`;

export class AuditLegalHoldsRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(status?: string): Promise<LegalHoldRow[]> {
    try {
      const q = status
        ? sql`select ${COLS} from audit_legal_holds where status = ${status} order by created_at desc`
        : sql`select ${COLS} from audit_legal_holds order by created_at desc`;
      return (await q.execute(this.db as any)).rows as LegalHoldRow[];
    } catch { return []; }
  }
  async get(id: string): Promise<LegalHoldRow | null> {
    const r = (await sql`select ${COLS} from audit_legal_holds where id = ${id} limit 1`.execute(this.db as any)).rows[0] as LegalHoldRow | undefined;
    return r ?? null;
  }
  async countActive(): Promise<number> {
    try { const r = (await sql`select count(*)::int as c from audit_legal_holds where status = 'active'`.execute(this.db as any)).rows[0] as { c: number }; return r?.c ?? 0; } catch { return 0; }
  }
  async activeHolds(): Promise<{ status: string; scope_type: string; scope_value: string | null }[]> {
    try { return (await sql`select status, scope_type, scope_value from audit_legal_holds where status = 'active'`.execute(this.db as any)).rows as any[]; } catch { return []; }
  }
  async insert(i: { holdRef: string; scopeType: string; scopeValue: string | null; reason: string; legalAuthority: string | null; createdBy: string | null; reviewDate: string | null; expirationDate: string | null }): Promise<LegalHoldRow> {
    const r = (await sql`insert into audit_legal_holds (hold_ref, scope_type, scope_value, reason, legal_authority, created_by, review_date, expiration_date)
      values (${i.holdRef}, ${i.scopeType}, ${i.scopeValue}, ${i.reason}, ${i.legalAuthority}, ${i.createdBy}, ${i.reviewDate}, ${i.expirationDate}) returning ${COLS}`.execute(this.db as any)).rows[0] as LegalHoldRow;
    return r;
  }
  async release(id: string, releasedBy: string | null, reason: string): Promise<void> {
    await sql`update audit_legal_holds set status = 'released', released_by = ${releasedBy}, released_at = now(), release_reason = ${reason} where id = ${id} and status = 'active' and ${canMoveToSql(AUDIT_LEGAL_HOLD, 'released')}`.execute(this.db as any);
  }
  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, severity: string, metadata: unknown) {
    if (!tenantId) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'audit-logs', ${action}, 'legal_hold', ${summary}, 'ok', ${severity}, ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
