// voice-key.kysely.repository.ts — production persistence for voice integration keys, over the 298 migration.
// Verification is by secret_hash on non-revoked rows (indexed). tenant/branch are read back from the row on the hot path.
import { sql, type Kysely } from 'kysely';
import type { VoiceKeyRepo, VoiceKeyRow } from './voice-key.service';

const ms = (v: any): number | null => (v == null ? null : new Date(v).getTime());

function toRow(r: any): VoiceKeyRow {
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, label: r.label, provider: r.provider,
    prefix: r.prefix, secretHash: r.secret_hash, lastUsedMs: ms(r.last_used_at), expiresMs: ms(r.expires_at),
    revokedMs: ms(r.revoked_at), createdMs: ms(r.created_at) ?? Date.now(),
  };
}

export class KyselyVoiceKeyRepo implements VoiceKeyRepo {
  constructor(private readonly db: Kysely<any>) {}

  async insert(row: any): Promise<VoiceKeyRow> {
    const r = (await sql`
      INSERT INTO voice_integration_keys (id, tenant_id, branch_id, label, provider, prefix, secret_hash, expires_at, created_by_user_id)
      VALUES (${row.id}, ${row.tenantId}, ${row.branchId}, ${row.label}, ${row.provider}, ${row.prefix}, ${row.secretHash},
              ${row.expiresMs ? new Date(row.expiresMs).toISOString() : null}, ${row.createdByUserId ?? null})
      RETURNING *`.execute(this.db)).rows[0];
    return toRow(r);
  }

  async findActiveByHash(secretHash: string): Promise<VoiceKeyRow | null> {
    const r = (await sql`
      SELECT * FROM voice_integration_keys WHERE secret_hash = ${secretHash} AND revoked_at IS NULL LIMIT 1`.execute(this.db)).rows[0];
    return r ? toRow(r) : null;
  }

  async touchLastUsed(id: string, whenMs: number): Promise<void> {
    await sql`UPDATE voice_integration_keys SET last_used_at = ${new Date(whenMs).toISOString()}, updated_at = now() WHERE id = ${id}`.execute(this.db);
  }

  async revoke(tenantId: string, id: string, whenMs: number): Promise<boolean> {
    const r = (await sql`
      UPDATE voice_integration_keys SET revoked_at = ${new Date(whenMs).toISOString()}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND revoked_at IS NULL RETURNING id`.execute(this.db)).rows;
    return r.length > 0;
  }

  async listForTenant(tenantId: string): Promise<VoiceKeyRow[]> {
    const rows = (await sql`SELECT * FROM voice_integration_keys WHERE tenant_id = ${tenantId} ORDER BY created_at DESC`.execute(this.db)).rows;
    return rows.map(toRow);
  }
}
