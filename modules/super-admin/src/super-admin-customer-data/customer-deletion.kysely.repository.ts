// Kysely (Postgres) implementation of the deletion repo. "Permanent deletion under approved process" is performed
// as an FK-safe PII ERASURE: the customer's personal data is irreversibly scrubbed and the row is marked deleted +
// archived, while transactional/audit references (tickets, payments) keep referential integrity. This is the
// GDPR-correct "right to erasure" outcome and cannot be undone. Exercised via ops/smoke, not the offline suite.

import { sql, type Kysely } from 'kysely';
import { safeInet } from '@aipowersalon/database';   // INET column: a raw proxy-chain ip would throw and the row would be lost
import type { DB } from '@aipowersalon/database';
import type { DeletionStatus } from './deletion-workflow';
import type { DeletionRepo, DeletionRequest, CreateDeletionInput, DeletionAudit } from './customer-deletion.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_DELETION_REQUEST } from '../lifecycles';

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : d == null ? '' : String(d));
const isoN = (d: unknown): string | null => (d == null ? null : iso(d));

function mapReq(r: any): DeletionRequest {
  return {
    id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, reason: r.reason, status: r.status,
    requestedByUserId: r.requested_by_user_id, approvedByUserId: r.approved_by_user_id, executedByUserId: r.executed_by_user_id,
    rejectReason: r.reject_reason, retentionChecked: !!r.retention_checked, retentionNote: r.retention_note, legalHoldBlocked: !!r.legal_hold_blocked,
    requestedAt: iso(r.requested_at), approvedAt: isoN(r.approved_at), executedAt: isoN(r.executed_at),
  };
}

export class KyselyDeletionRepo implements DeletionRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async create(input: CreateDeletionInput): Promise<DeletionRequest> {
    const res = await sql<any>`
      INSERT INTO customer_deletion_requests (tenant_id, customer_id, reason, status, requested_by_user_id)
      VALUES (${input.tenantId}, ${input.customerId}, ${input.reason}, 'requested', ${input.requestedByUserId})
      RETURNING *`.execute(this.db);
    return mapReq(res.rows[0]);
  }
  async get(id: string): Promise<DeletionRequest | null> {
    const res = await sql<any>`SELECT * FROM customer_deletion_requests WHERE id = ${id} LIMIT 1`.execute(this.db);
    return res.rows[0] ? mapReq(res.rows[0]) : null;
  }
  async list(scope: { tenantId?: string; status?: string }): Promise<DeletionRequest[]> {
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    const s = scope.status ? sql`AND status = ${scope.status}` : sql``;
    const res = await sql<any>`SELECT * FROM customer_deletion_requests WHERE 1=1 ${t} ${s} ORDER BY requested_at DESC LIMIT 200`.execute(this.db);
    return res.rows.map(mapReq);
  }
  async setStatus(id: string, status: DeletionStatus, patch: Partial<DeletionRequest> = {}): Promise<void> {
    await sql`
      UPDATE customer_deletion_requests SET status = ${status},
        approved_by_user_id = COALESCE(${patch.approvedByUserId ?? null}, approved_by_user_id),
        approved_at = COALESCE(${patch.approvedAt ?? null}, approved_at),
        executed_by_user_id = COALESCE(${patch.executedByUserId ?? null}, executed_by_user_id),
        executed_at = COALESCE(${patch.executedAt ?? null}, executed_at),
        reject_reason = COALESCE(${patch.rejectReason ?? null}, reject_reason),
        retention_checked = COALESCE(${patch.retentionChecked ?? null}, retention_checked),
        retention_note = COALESCE(${patch.retentionNote ?? null}, retention_note),
        legal_hold_blocked = COALESCE(${patch.legalHoldBlocked ?? null}, legal_hold_blocked),
        updated_at = now()
      WHERE id = ${id} AND ${status === 'requested' ? sql`status = 'requested'` : sql`(status = ${status} OR ${canMoveToSql(CUSTOMER_DELETION_REQUEST, status)})`}`.execute(this.db);   // Phase 12 (#27): a move, or the blocked-execution snapshot (same status)
  }
  /** No retention-policy schema exists yet, so nothing here blocks deletion; the check is honest and explicit. */
  async retentionAllows(): Promise<{ ok: boolean; note: string | null }> {
    return { ok: true, note: 'No retention policy is configured that blocks this deletion.' };
  }
  /** FK-safe permanent erasure of personal data. Irreversible. */
  async hardDeleteCustomer(tenantId: string, customerId: string): Promise<boolean> {
    const res = await sql`
      UPDATE customers SET
        first_name = '', last_name = '', full_name = '[deleted]',
        normalized_phone = NULL, phone_display = NULL, email = NULL, birthday = NULL,
        avatar_url = NULL, notes = NULL, allergies = NULL, safety_notes = NULL,
        marketing_sms_opt_in = false, marketing_email_opt_in = false, marketing_opt_in = false,
        status = 'deleted', archived_at = now(), updated_at = now()
      WHERE id = ${customerId} AND tenant_id = ${tenantId}`.execute(this.db);
    return Number(res.numAffectedRows ?? 0n) > 0;
  }
  async writeAudit(entry: DeletionAudit): Promise<void> {
    await sql`
      INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      VALUES (${entry.tenantId}, ${entry.actorUserId ?? null}, 'SUPER_ADMIN', ${entry.actionType}, 'customer', ${entry.customerId}, ${safeInet(entry.ip)},
        ${JSON.stringify({ ...entry.detail, requestId: entry.requestId, source: 'customer_data_oversight_deletion' })}::jsonb)`.execute(this.db);
  }
}
