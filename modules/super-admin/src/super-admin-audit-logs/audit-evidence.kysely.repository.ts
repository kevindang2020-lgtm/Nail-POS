// audit-evidence.kysely.repository.ts — evidence packet metadata + append-only chain of custody. Custody rows are only
// ever inserted. Packet content is not persisted; the checksum + manifest let integrity be re-verified on demand.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export interface EvidencePackRow { id: string; pack_ref: string; requested_by: string | null; scope: any; format: string; event_count: number; checksum: string; manifest: any; redaction_applied: boolean; status: string; created_at: string; expires_at: string | null }
export interface CustodyRow { id: string; entry_type: string; actor: string | null; purpose: string | null; created_at: string }
const COLS = sql`id::text as id, pack_ref, requested_by, scope, format, event_count, checksum, manifest, redaction_applied, status, created_at::text as created_at, expires_at::text as expires_at`;

export class AuditEvidenceRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(limit = 25): Promise<EvidencePackRow[]> {
    try { return (await sql`select ${COLS} from audit_evidence_packs order by created_at desc limit ${limit}`.execute(this.db as any)).rows as EvidencePackRow[]; } catch { return []; }
  }
  async get(id: string): Promise<EvidencePackRow | null> {
    const r = (await sql`select ${COLS} from audit_evidence_packs where id = ${id} limit 1`.execute(this.db as any)).rows[0] as EvidencePackRow | undefined;
    return r ?? null;
  }
  async countReady(): Promise<number> {
    try { const r = (await sql`select count(*)::int as c from audit_evidence_packs where status = 'ready'`.execute(this.db as any)).rows[0] as { c: number }; return r?.c ?? 0; } catch { return 0; }
  }
  async insert(i: { packRef: string; requestedBy: string | null; requestedById: string | null; scope: unknown; format: string; eventCount: number; checksum: string; manifest: unknown; redactionApplied: boolean; expiresAt: string | null }): Promise<EvidencePackRow> {
    return (await sql`insert into audit_evidence_packs (pack_ref, requested_by, requested_by_id, scope, format, event_count, checksum, manifest, redaction_applied, expires_at)
      values (${i.packRef}, ${i.requestedBy}, ${i.requestedById}, ${JSON.stringify(i.scope ?? {})}::jsonb, ${i.format}, ${i.eventCount}, ${i.checksum}, ${JSON.stringify(i.manifest ?? {})}::jsonb, ${i.redactionApplied}, ${i.expiresAt})
      returning ${COLS}`.execute(this.db as any)).rows[0] as EvidencePackRow;
  }
  async appendCustody(packId: string, entryType: string, actor: string | null, purpose: string | null): Promise<void> {
    await sql`insert into audit_evidence_custody (pack_id, entry_type, actor, purpose) values (${packId}, ${entryType}, ${actor}, ${purpose})`.execute(this.db as any);
  }
  async custody(packId: string): Promise<CustodyRow[]> {
    return (await sql`select id::text as id, entry_type, actor, purpose, created_at::text as created_at from audit_evidence_custody where pack_id = ${packId} order by created_at asc, id asc`.execute(this.db as any)).rows as CustodyRow[];
  }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    if (!tenantId) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'audit-logs', ${action}, 'evidence_pack', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
