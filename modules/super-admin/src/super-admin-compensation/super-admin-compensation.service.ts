/**
 * super-admin-compensation.service.ts — §27 Super Admin cross-tenant oversight of compensation CONFIG adoption. For each
 * tenant that has configured anything, summarizes: active commission rules, tiered plans, bonus rules, worker
 * classifications set, and compensation agreements (total + acknowledged). Read-only aggregate; SuperAdminGuard enforced
 * at the controller. Best-effort: any query failure returns [].
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { TenantCompensationSummary } from '@aipowersalon/api-contracts/platform';
import type { TenantCompensationSummary } from '@aipowersalon/api-contracts/platform';


export class SuperAdminCompensationService {
  constructor(private readonly db: Kysely<DB> | null) {}

  async overview(): Promise<TenantCompensationSummary[]> {
    if (!this.db) return [];
    try {
      const res: any = await sql`
        SELECT t.id AS tenant_id, t.display_name AS tenant_name,
          COALESCE(r.c, 0)  AS active_rules,
          COALESCE(tp.c, 0) AS tier_plans,
          COALESCE(b.c, 0)  AS bonus_rules,
          COALESCE(cl.c, 0) AS classifications,
          COALESCE(ag.c, 0) AS agreements,
          COALESCE(ag.ack, 0) AS acknowledged_agreements
        FROM tenants t
        LEFT JOIN (SELECT tenant_id, COUNT(*) c FROM compensation_policy_versions WHERE status = 'active' GROUP BY tenant_id) r ON r.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, COUNT(*) c FROM technician_tier_plans WHERE status = 'active' GROUP BY tenant_id) tp ON tp.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, COUNT(*) c FROM bonus_rules WHERE status = 'active' GROUP BY tenant_id) b ON b.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, COUNT(*) c FROM technician_classifications GROUP BY tenant_id) cl ON cl.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, COUNT(*) c, COUNT(*) FILTER (WHERE status = 'acknowledged') ack FROM compensation_agreements GROUP BY tenant_id) ag ON ag.tenant_id = t.id
        ORDER BY t.display_name
      `.execute(this.db);
      const rows: any[] = res?.rows ?? res ?? [];
      return rows.map((r: any) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name ?? null,
        activeRules: Number(r.active_rules || 0),
        tierPlans: Number(r.tier_plans || 0),
        bonusRules: Number(r.bonus_rules || 0),
        classifications: Number(r.classifications || 0),
        agreements: Number(r.agreements || 0),
        acknowledgedAgreements: Number(r.acknowledged_agreements || 0),
      }));
    } catch { return []; }
  }
}
