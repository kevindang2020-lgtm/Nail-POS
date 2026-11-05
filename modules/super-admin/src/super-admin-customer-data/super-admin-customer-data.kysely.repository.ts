// Kysely (Postgres) implementation of the Customer Data Oversight repo.
// The customer projection is type-safe over the real `customers`/`tenants`/`branches` tables and ALWAYS filters
// archived rows; tenant/branch/status/search narrow it. Privacy/deletion/export counts come from existing infra
// (customer_privacy_requests, account_deletion_requests) via defensive raw SQL — on any error they return null so
// the module renders NotConnected rather than fabricating a number.
// NOTE: written against confirmed columns; exercised end-to-end against live Postgres via ops/smoke, not the unit suite.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { CustomerDataOversightRepo, OverviewScope, ProjectionRow, PrivacyCounts, SimpleReqCounts, MergeLogRow, ActivityRow } from './super-admin-customer-data.repository';

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : (d == null ? '' : String(d)));
const isoNull = (d: unknown): string | null => (d == null ? null : iso(d));

import { buildMediaUrl } from '@aipowersalon/media';

export class KyselyCustomerDataOversightRepo implements CustomerDataOversightRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async loadCustomerProjection(scope: OverviewScope): Promise<ProjectionRow[]> {
    let qb = this.db.selectFrom('customers as c')
      .leftJoin('tenants as t', 't.id', 'c.tenant_id')
      .leftJoin('branches as b', 'b.id', 'c.branch_id')
      .select([
        'c.id', 'c.tenant_id', 'c.branch_id', 'c.full_name', 'c.normalized_phone', 'c.email', 'c.phone_verified_at',
        'c.status', 'c.marketing_sms_opt_in', 'c.marketing_email_opt_in', 'c.marketing_opt_in', 'c.created_by_user_id',
        'c.created_at', 'c.updated_at', 'c.avatar_url', 't.display_name as tenant_name', 'b.name as branch_name',
      ])
      .where('c.archived_at', 'is', null);
    if (scope.tenantId) qb = qb.where('c.tenant_id', '=', scope.tenantId);
    if (scope.branchId) qb = qb.where('c.branch_id', '=', scope.branchId);
    if (scope.status) qb = qb.where(sql`lower(c.status)`, '=', scope.status.toLowerCase());
    if (scope.search) { const s = `%${scope.search}%`; qb = qb.where((eb) => eb.or([eb('c.full_name', 'ilike', s), eb('c.email', 'ilike', s), eb(sql`c.id::text`, 'ilike', s)])); }
    const rows = await qb.limit(scope.cap ?? 5000).execute();
    return rows.map((r: any): ProjectionRow => ({
      id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, fullName: r.full_name,
      avatarUrl: r.avatar_url ? buildMediaUrl(r.avatar_url) : null,
      normalizedPhone: r.normalized_phone, email: r.email, phoneVerifiedAt: isoNull(r.phone_verified_at),
      status: r.status, marketingSmsOptIn: !!r.marketing_sms_opt_in, marketingEmailOptIn: !!r.marketing_email_opt_in,
      marketingOptIn: !!r.marketing_opt_in, createdById: r.created_by_user_id, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      tenantName: r.tenant_name ?? null, branchName: r.branch_name ?? null,
      importSource: null,            // no import-source column on customers yet → honest Unknown
      privacyRequestLabel: null,     // per-row privacy join not modelled yet → honest None
    }));
  }

  async privacyCounts(scope: OverviewScope): Promise<PrivacyCounts | null> {
    try {
      const tenantClause = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<{ status: string; n: number }>`
        SELECT status, count(*)::int AS n FROM customer_privacy_requests WHERE 1=1 ${tenantClause} GROUP BY status
      `.execute(this.db);
      const byStatus = res.rows.map((r) => ({ key: r.status, label: titleize(r.status), count: Number(r.n) }));
      const total = byStatus.reduce((a, b) => a + b.count, 0);
      const pending = byStatus.filter((b) => !['completed', 'rejected', 'cancelled', 'denied'].includes(b.key)).reduce((a, b) => a + b.count, 0);
      return { total, pending, byStatus };
    } catch { return null; }
  }

  async deletionCounts(scope: OverviewScope): Promise<SimpleReqCounts | null> {
    try {
      const tenantClause = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<{ total: number; pending: number }>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status NOT IN ('completed','rejected','cancelled','denied'))::int AS pending
        FROM account_deletion_requests WHERE 1=1 ${tenantClause}
      `.execute(this.db);
      const r = res.rows[0]; return r ? { total: Number(r.total), pending: Number(r.pending) } : null;
    } catch { return null; }
  }

  async exportCounts(scope: OverviewScope): Promise<SimpleReqCounts | null> {
    try {
      const tenantClause = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<{ total: number; pending: number }>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status NOT IN ('completed','rejected','cancelled','denied'))::int AS pending
        FROM customer_privacy_requests WHERE request_type = 'export' ${tenantClause}
      `.execute(this.db);
      const r = res.rows[0]; return r ? { total: Number(r.total), pending: Number(r.pending) } : null;
    } catch { return null; }
  }

  async recentMerges(scope: OverviewScope): Promise<MergeLogRow[]> {
    try {
      const t = scope.tenantId ? sql`WHERE tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<any>`
        SELECT id, source_customer_id, target_customer_id, merged_by_user_id, created_at
        FROM customer_merge_logs ${t} ORDER BY created_at DESC LIMIT 15`.execute(this.db);
      return res.rows.map((r) => ({ id: r.id, sourceCustomerId: r.source_customer_id, targetCustomerId: r.target_customer_id, mergedByUserId: r.merged_by_user_id, mergedAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
    } catch { return []; }
  }

  async mergeHistory(scope: OverviewScope): Promise<MergeLogRow[]> {
    try {
      const t = scope.tenantId ? sql`WHERE tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<any>`
        SELECT id, source_customer_id, target_customer_id, merged_by_user_id, created_at
        FROM customer_merge_logs ${t} ORDER BY created_at DESC LIMIT 200`.execute(this.db);
      return res.rows.map((r) => ({ id: r.id, sourceCustomerId: r.source_customer_id, targetCustomerId: r.target_customer_id, mergedByUserId: r.merged_by_user_id, mergedAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
    } catch { return []; }
  }

  async recentActivity(scope: OverviewScope): Promise<ActivityRow[]> {
    try {
      const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<any>`
        SELECT action_type, entity_type, entity_id, user_id, created_at FROM audit_logs
        WHERE (entity_type IN ('customer','customer_legal_hold','customer_import_job')
               OR action_type LIKE 'customer_%' OR action_type LIKE 'super_admin_customer_%') ${t}
        ORDER BY created_at DESC LIMIT 20`.execute(this.db);
      return res.rows.map((r) => ({ action: r.action_type, entityType: r.entity_type, entityId: r.entity_id, actorUserId: r.user_id, at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
    } catch { return []; }
  }

  async auditHistory(scope: OverviewScope): Promise<ActivityRow[]> {
    try {
      const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
      const res = await sql<any>`
        SELECT action_type, entity_type, entity_id, user_id, created_at FROM audit_logs
        WHERE (entity_type IN ('customer','customer_legal_hold','customer_import_job')
               OR action_type LIKE 'customer_%' OR action_type LIKE 'super_admin_customer_%') ${t}
        ORDER BY created_at DESC LIMIT 200`.execute(this.db);
      return res.rows.map((r) => ({ action: r.action_type, entityType: r.entity_type, entityId: r.entity_id, actorUserId: r.user_id, at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) }));
    } catch { return []; }
  }

}

function titleize(s: string): string {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
