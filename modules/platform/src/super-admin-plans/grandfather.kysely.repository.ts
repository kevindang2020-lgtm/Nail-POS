// grandfather.kysely.repository.ts — real reads/writes for grandfathered assignments.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { GrandfatherRepo, PlanVersionInfo, GrandfatherRow, AuditActor } from './grandfather.repository';
import type { NormalizedGrandfather } from './plan-mutations-core';

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

export class KyselyGrandfatherRepo implements GrandfatherRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async tenantExists(tenantId: string): Promise<boolean> {
    const r: any = await sql`SELECT 1 FROM tenants WHERE id = ${tenantId} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).length > 0;
  }

  async getPlanVersionInfo(planVersionId: string): Promise<PlanVersionInfo | null> {
    const r: any = await sql`SELECT v.id, p.code AS plan_code, v.version_number, v.monthly_price_cents
                             FROM subscription_plan_versions v JOIN subscription_plans p ON p.id = v.plan_id
                             WHERE v.id = ${planVersionId}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; return x ? { id: String(x.id), planCode: String(x.plan_code), versionNumber: Number(x.version_number), monthlyPriceCents: Number(x.monthly_price_cents) } : null;
  }

  async upsertAssignment(n: NormalizedGrandfather, lockedPriceCents: number, createdBy: string | null): Promise<string> {
    const r: any = await sql`INSERT INTO grandfathered_assignments
        (tenant_id, plan_version_id, locked_monthly_price_cents, effective_from, end_date, migration_target_plan_code, reason, created_by)
      VALUES (${n.tenantId}, ${n.planVersionId}, ${lockedPriceCents}, COALESCE(${n.effectiveFrom}::timestamptz, now()), ${n.endDate}::timestamptz, ${n.migrationTargetPlanCode}, ${n.reason}, ${createdBy})
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_version_id = EXCLUDED.plan_version_id, locked_monthly_price_cents = EXCLUDED.locked_monthly_price_cents,
        effective_from = EXCLUDED.effective_from, end_date = EXCLUDED.end_date,
        migration_target_plan_code = EXCLUDED.migration_target_plan_code, reason = EXCLUDED.reason, updated_at = now()
      RETURNING id`.execute(this.db);
    return String(r.rows[0].id);
  }

  async listAssignments(): Promise<GrandfatherRow[]> {
    const r: any = await sql`SELECT g.tenant_id, COALESCE(t.display_name, t.legal_name, g.tenant_id::text) AS tenant_name,
                                    p.code AS plan_code, v.version_number, g.locked_monthly_price_cents,
                                    g.effective_from, g.end_date, g.migration_target_plan_code, g.reason, g.created_at
                             FROM grandfathered_assignments g
                             JOIN tenants t ON t.id = g.tenant_id
                             LEFT JOIN subscription_plan_versions v ON v.id = g.plan_version_id
                             LEFT JOIN subscription_plans p ON p.id = v.plan_id
                             ORDER BY g.created_at DESC`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({
      tenantId: String(x.tenant_id), tenantName: String(x.tenant_name),
      planCode: x.plan_code ?? null, versionNumber: x.version_number == null ? null : Number(x.version_number),
      lockedMonthlyPriceCents: x.locked_monthly_price_cents == null ? null : Number(x.locked_monthly_price_cents),
      effectiveFrom: iso(x.effective_from), endDate: iso(x.end_date),
      migrationTargetPlanCode: x.migration_target_plan_code ?? null, reason: x.reason ?? null, createdAt: iso(x.created_at) as string,
    }));
  }

  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: entityId, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'grandfathered_assignment', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }
}
