// commission-history.query.ts — the Super Admin commission-change history (GET /super-admin/commission-oversight).
// SCAN (Oct 12 2026): the join compared `t.id::text = c.tenant_id` — once migration 539 made commission_change_audit_logs
// .tenant_id a uuid that became `text = uuid`, Postgres refused it on EVERY request, and the controller's
// `.catch(() => ({ rows: [] }))` turned the failure into an empty history: the page said "no commission changes" while
// the query had never run. Both sides are compared as text now (true whichever type each column has), and a failure
// is no longer swallowed.
import { sql, type Kysely } from 'kysely';

export async function fetchCommissionHistory(db: Kysely<any>, limit = 100): Promise<any[]> {
  const r: any = await sql`
    SELECT c.id, c.tenant_id as "tenantId", t.display_name as "tenantName",
           c.technician_id as "technicianId", c.target_type as "targetType",
           tech.full_name as "techName", tech.email as "techEmail",
           c.old_commission_percent as "oldCommissionPercent",
           c.new_commission_percent as "newCommissionPercent",
           c.requested_by_name as "requestedByName",
           c.requested_by_role as "requestedByRole",
           c.authorized_by_name as "authorizedByName",
           c.auth_code_used as "authCodeUsed",
           c.created_at as "createdAt"
    FROM commission_change_audit_logs c
    LEFT JOIN tenants t ON t.id::text = c.tenant_id::text
    LEFT JOIN technicians tech ON tech.id::text = c.technician_id::text
    ORDER BY c.created_at DESC
    LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}
  `.execute(db);
  return r?.rows ?? [];
}
