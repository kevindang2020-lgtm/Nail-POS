// Kysely (Postgres) compliance repo. Flags carry a review lifecycle; pausing is an actioned flag (audited). Limits
// use the single-active-row unique index (a new active row supersedes the prior).

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ComplianceRepo, FlagRow, LimitsRow } from './campaign-compliance.repository';
import type { LimitsInput } from './campaign-compliance-core';
import { canMoveToSql } from '@aipowersalon/database';
import { CAMPAIGN_COMPLIANCE_FLAG } from '../communications-lifecycles';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const flagRow = (r: any): FlagRow => ({
  id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, subjectName: r.subject_name, tenantId: r.tenant_id,
  flagType: r.flag_type, severity: r.severity, status: r.status, actionTaken: r.action_taken, detail: r.detail, reason: r.reason,
  createdAt: iso(r.created_at) as string, resolvedAt: iso(r.resolved_at),
});
const limitsRow = (r: any): LimitsRow => ({
  id: r.id, maxSendsPerDay: num(r.max_sends_per_day), maxCampaignsPerDay: num(r.max_campaigns_per_day),
  quietHoursStart: num(r.quiet_hours_start), quietHoursEnd: num(r.quiet_hours_end), minHoursBetween: num(r.min_hours_between), createdAt: iso(r.created_at) as string,
});

export class KyselyComplianceRepo implements ComplianceRepo {
  constructor(private readonly db: Kysely<DB>) {}

  /**
   * 🔴 CROSS-TENANT LEAK, FIXED.
   *
   * This was `WHERE 1=1 ${st}` with no tenant filter, reached from `GET /pos/campaigns/compliance/flags` behind
   * TenantAuthGuard — so **any salon's staff could read every other salon's compliance flags**.
   *
   * `tenantId` is now REQUIRED and comes from the verified session. A missing tenant returns nothing rather than
   * everything: the failure mode of a scoping bug must be "see less", never "see all".
   */
  async listFlags(scope: { tenantId: string; status?: string; cap?: number }): Promise<FlagRow[]> {
    if (!scope.tenantId) return [];
    const st = scope.status ? sql`AND status = ${scope.status}` : sql``;
    try {
      const r = await sql<any>`
        SELECT * FROM campaign_compliance_flags
        WHERE tenant_id = ${scope.tenantId} ${st}
        ORDER BY created_at DESC LIMIT ${Math.min(1000, scope.cap ?? 200)}`.execute(this.db);
      return r.rows.map(flagRow);
    } catch { return []; }
  }
  async raiseFlag(input: { subjectType: string; subjectId: string; subjectName?: string | null; tenantId?: string | null; flagType: string; severity?: string; detail?: string | null; raisedByUserId?: string | null }): Promise<FlagRow> {
    const r = await sql<any>`
      INSERT INTO campaign_compliance_flags (subject_type, subject_id, subject_name, tenant_id, flag_type, severity, detail, raised_by_user_id)
      VALUES (${input.subjectType}, ${input.subjectId}, ${input.subjectName ?? null}, ${input.tenantId ?? null}, ${input.flagType}, ${input.severity || 'medium'}, ${input.detail ?? null}, ${input.raisedByUserId ?? null})
      RETURNING *`.execute(this.db);
    // Attribute the audit record to the tenant the flag belongs to. An audit_logs row with a null tenant_id is an
    // UNATTRIBUTED entry — it weakens the append-only trail it is supposed to strengthen.
    try { await sql`INSERT INTO audit_logs (tenant_id, action_type, entity_type, entity_id, user_id, created_at) VALUES (${input.tenantId ?? null}, 'campaign_compliance_flagged', 'campaign', ${input.subjectId}, ${input.raisedByUserId ?? null}, now())`.execute(this.db); } catch { /* best-effort */ }
    return flagRow(r.rows[0]);
  }
  /**
   * 🔴 CROSS-TENANT WRITE, FIXED.
   *
   * This updated `WHERE id = ${id}` with no tenant check — so a manager at Salon A could resolve **Salon B's**
   * compliance flag. Now the row must belong to the caller's tenant; if it does not, nothing is updated and null
   * comes back, which is indistinguishable from "no such flag".
   */
  async resolveFlag(id: string, tenantId: string, status: 'cleared' | 'actioned', extra?: { actionTaken?: string; reason?: string; resolvedByUserId?: string | null }): Promise<FlagRow | null> {
    if (!tenantId) return null;
    const r = await sql<any>`
      UPDATE campaign_compliance_flags SET status = ${status}, action_taken = COALESCE(${extra?.actionTaken ?? null}, action_taken),
        reason = COALESCE(${extra?.reason ?? null}, reason), resolved_by_user_id = ${extra?.resolvedByUserId ?? null}, resolved_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND ${canMoveToSql(CAMPAIGN_COMPLIANCE_FLAG, status)} RETURNING *`.execute(this.db);
    if (!r.rows[0]) return null;
    try { await sql`INSERT INTO audit_logs (tenant_id, action_type, entity_type, entity_id, user_id, created_at) VALUES (${tenantId}, 'campaign', ${flagRow(r.rows[0]).subjectId}, ${extra?.resolvedByUserId ?? null}, now())`.execute(this.db); } catch { /* best-effort */ }
    return flagRow(r.rows[0]);
  }
  /**
   * The same read, WITHOUT swallowing errors — for ENFORCEMENT. getActiveLimits() returns null on a query error,
   * which is fine for a display screen but would mean "no limits" to the send path: a database hiccup would lift
   * every cap and quiet window at once. The send path uses this and refuses to start a campaign if it throws.
   */
  async getActiveLimitsStrict(): Promise<LimitsRow | null> {
    const r = await sql<any>`SELECT * FROM campaign_limits WHERE active = true LIMIT 1`.execute(this.db);
    return r.rows[0] ? limitsRow(r.rows[0]) : null;
  }
  async getActiveLimits(): Promise<LimitsRow | null> {
    try { const r = await sql<any>`SELECT * FROM campaign_limits WHERE active = true LIMIT 1`.execute(this.db); return r.rows[0] ? limitsRow(r.rows[0]) : null; } catch { return null; }
  }
  async setLimits(input: LimitsInput & { updatedByUserId?: string | null }): Promise<LimitsRow> {
    await sql`UPDATE campaign_limits SET active = false WHERE active = true`.execute(this.db);
    const r = await sql<any>`
      INSERT INTO campaign_limits (max_sends_per_day, max_campaigns_per_day, quiet_hours_start, quiet_hours_end, min_hours_between, active, updated_by_user_id)
      VALUES (${input.maxSendsPerDay ?? null}, ${input.maxCampaignsPerDay ?? null}, ${input.quietHoursStart ?? null}, ${input.quietHoursEnd ?? null}, ${input.minHoursBetween ?? null}, true, ${input.updatedByUserId ?? null})
      RETURNING *`.execute(this.db);
    return limitsRow(r.rows[0]);
  }
}
