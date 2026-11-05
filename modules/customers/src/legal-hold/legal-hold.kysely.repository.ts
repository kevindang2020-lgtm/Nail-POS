// Kysely (Postgres) implementation of the legal-hold repo. Raw SQL against customer_legal_holds (added in
// migration 172) + an audit row per applied/released hold. Targets confirmed columns; exercised end-to-end via
// ops/smoke, not the offline unit suite.

import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_LEGAL_HOLD } from '../customer-lifecycles';
import { sql, type Kysely } from 'kysely';
import { safeInet } from '@aipowersalon/database';   // INET column: a raw proxy-chain ip would throw and the row would be lost
import type { DB } from '@aipowersalon/database';
import type { LegalHoldRepo, LegalHold, ApplyHoldRecord, LegalHoldAudit } from './legal-hold.repository';

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : d == null ? '' : String(d));
const isoN = (d: unknown): string | null => (d == null ? null : iso(d));

function mapRow(r: any): LegalHold {
  return {
    id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, branchId: r.branch_id, matterRef: r.matter_ref,
    reason: r.reason, scope: r.scope, status: r.status, appliedByUserId: r.applied_by_user_id, approvedByUserId: r.approved_by_user_id,
    appliedAt: iso(r.applied_at), effectiveAt: iso(r.effective_at), reviewAt: isoN(r.review_at),
    releasedByUserId: r.released_by_user_id, releasedAt: isoN(r.released_at), releaseReason: r.release_reason, internalNotes: r.internal_notes,
  };
}

export class KyselyLegalHoldRepo implements LegalHoldRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async applyHold(input: ApplyHoldRecord): Promise<LegalHold> {
    const res = await sql<any>`
      INSERT INTO customer_legal_holds (tenant_id, customer_id, branch_id, matter_ref, reason, scope, status, applied_by_user_id, approved_by_user_id, review_at, internal_notes)
      VALUES (${input.tenantId}, ${input.customerId}, ${input.branchId}, ${input.matterRef}, ${input.reason}, ${input.scope}, 'active', ${input.appliedByUserId}, ${input.approvedByUserId}, ${input.reviewAt}, ${input.internalNotes})
      RETURNING *
    `.execute(this.db);
    return mapRow(res.rows[0]);
  }
  async getHold(id: string): Promise<LegalHold | null> {
    const res = await sql<any>`SELECT * FROM customer_legal_holds WHERE id = ${id} LIMIT 1`.execute(this.db);
    return res.rows[0] ? mapRow(res.rows[0]) : null;
  }
  async releaseHold(id: string, opts: { reason: string; byUserId?: string }): Promise<boolean> {
    const res = await sql`
      UPDATE customer_legal_holds SET status = 'released', released_at = now(), release_reason = ${opts.reason}, released_by_user_id = ${opts.byUserId ?? null}, updated_at = now()
      WHERE id = ${id} AND status = 'active' AND ${canMoveToSql(CUSTOMER_LEGAL_HOLD, 'released')}
    `.execute(this.db);
    return Number(res.numAffectedRows ?? 0n) > 0;
  }
  async listHolds(scope: { tenantId?: string; status?: string }): Promise<LegalHold[]> {
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    const s = scope.status ? sql`AND status = ${scope.status}` : sql``;
    const res = await sql<any>`SELECT * FROM customer_legal_holds WHERE 1=1 ${t} ${s} ORDER BY applied_at DESC LIMIT 500`.execute(this.db);
    return res.rows.map(mapRow);
  }
  async activeHoldsForCustomer(tenantId: string, customerId: string): Promise<LegalHold[]> {
    const res = await sql<any>`
      SELECT * FROM customer_legal_holds
      WHERE status = 'active' AND tenant_id = ${tenantId} AND (customer_id = ${customerId} OR scope IN ('tenant','branch'))
    `.execute(this.db);
    return res.rows.map(mapRow);
  }
  async counts(scope: { tenantId?: string }): Promise<{ total: number; tenantCount: number }> {
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    const res = await sql<{ total: number; tenants: number }>`
      SELECT count(*)::int AS total, count(distinct tenant_id)::int AS tenants FROM customer_legal_holds WHERE status = 'active' ${t}
    `.execute(this.db);
    const r = res.rows[0]; return { total: Number(r?.total ?? 0), tenantCount: Number(r?.tenants ?? 0) };
  }
  async writeAudit(entry: LegalHoldAudit): Promise<void> {
    await sql`
      INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      VALUES (${entry.tenantId}, ${entry.actorUserId ?? null}, 'SUPER_ADMIN', ${entry.actionType}, 'customer_legal_hold', ${entry.holdId}, ${safeInet(entry.ip)},
        ${JSON.stringify({ customerId: entry.customerId, reason: entry.reason, source: 'customer_data_oversight_legal_hold' })}::jsonb)
    `.execute(this.db);
  }
}
