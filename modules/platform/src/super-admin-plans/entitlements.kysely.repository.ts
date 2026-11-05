// entitlements.kysely.repository.ts — real reads/writes for tenant entitlements. Active overrides exclude expired rows.
// Used counts come from authoritative operational tables (customers/branches/users) so enforcement reconciles with data.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type {
  EntitlementsRepo, ActiveLimitOverride, ActiveFeatureOverride, CatalogPlanRef, AuditActor,
  LimitOverrideWrite, FeatureOverrideWrite,
} from './entitlements.repository';

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export class KyselyEntitlementsRepo implements EntitlementsRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async tenantExists(tenantId: string): Promise<boolean> {
    const r: any = await sql`SELECT EXISTS(SELECT 1 FROM tenants WHERE id = ${tenantId}) AS e`.execute(this.db);
    return !!r.rows[0]?.e;
  }

  async listActiveTenants(): Promise<{ id: string; name: string; planText: string | null }[]> {
    const r: any = await sql`SELECT ts.tenant_id, COALESCE(t.display_name, t.legal_name, ts.tenant_id::text) AS name, ts.plan
                             FROM tenant_subscriptions ts JOIN tenants t ON t.id = ts.tenant_id
                             WHERE COALESCE(t.status, 'active') <> 'archived'
                             ORDER BY name`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({ id: String(x.tenant_id), name: String(x.name), planText: x.plan ?? null }));
  }

  async getActivePlanText(tenantId: string): Promise<string | null> {
    const r: any = await sql`SELECT plan FROM tenant_subscriptions WHERE tenant_id = ${tenantId}
                             AND lower(status) = 'active' ORDER BY current_period_end DESC NULLS LAST LIMIT 1`.execute(this.db);
    return r.rows[0]?.plan != null ? String(r.rows[0].plan) : null;
  }

  async mapCatalogPlan(planText: string): Promise<CatalogPlanRef | null> {
    const r: any = await sql`SELECT id, code, name FROM subscription_plans
                             WHERE lower(code) = lower(${planText}) OR lower(name) = lower(${planText}) LIMIT 1`.execute(this.db);
    if (!r.rows.length) return null;
    return { id: String(r.rows[0].id), code: String(r.rows[0].code), name: String(r.rows[0].name) };
  }

  async getPlanLimits(planId: string): Promise<Record<string, number | null>> {
    const r: any = await sql`SELECT metric, limit_value FROM plan_limits WHERE plan_id = ${planId}`.execute(this.db);
    const out: Record<string, number | null> = {};
    for (const row of r.rows as any[]) out[String(row.metric)] = numOrNull(row.limit_value);
    return out;
  }

  async getPlanFeatureStates(planId: string): Promise<Record<string, string>> {
    const r: any = await sql`SELECT feature_key, state FROM plan_features WHERE plan_id = ${planId}`.execute(this.db);
    const out: Record<string, string> = {};
    for (const row of r.rows as any[]) out[String(row.feature_key)] = String(row.state);
    return out;
  }

  async getLimitOverrides(tenantId: string): Promise<ActiveLimitOverride[]> {
    const r: any = await sql`SELECT metric, limit_value, enforcement, reason, expires_at FROM tenant_plan_limit_overrides
                             WHERE tenant_id = ${tenantId} AND (expires_at IS NULL OR expires_at > now())`.execute(this.db);
    return (r.rows as any[]).map((row) => ({ metric: String(row.metric), limit_value: numOrNull(row.limit_value), enforcement: String(row.enforcement), reason: row.reason ?? null, expires_at: iso(row.expires_at) }));
  }

  async getFeatureOverrides(tenantId: string): Promise<ActiveFeatureOverride[]> {
    const r: any = await sql`SELECT feature_key, state, reason, expires_at FROM tenant_feature_overrides
                             WHERE tenant_id = ${tenantId} AND (expires_at IS NULL OR expires_at > now())`.execute(this.db);
    return (r.rows as any[]).map((row) => ({ feature_key: String(row.feature_key), state: String(row.state), reason: row.reason ?? null, expires_at: iso(row.expires_at) }));
  }

  // Authoritative usage for the metrics we can directly meter. Each count is independent so one failing table never
  // wipes the others (which would silently disable enforcement everywhere).
  async getUsedCounts(tenantId: string): Promise<Record<string, number>> {
    const counts: Record<string, string> = {
      customers: 'customers', branches: 'branches', users: 'users', technicians: 'technicians',
    };
    const out: Record<string, number> = {};
    await Promise.all(Object.entries(counts).map(async ([metric, table]) => {
      try {
        const r: any = await sql`SELECT COUNT(*)::int AS n FROM ${sql.ref(table)} WHERE tenant_id = ${tenantId}`.execute(this.db);
        if (r.rows[0]?.n !== undefined && r.rows[0]?.n !== null) out[metric] = Number(r.rows[0].n);
      } catch { /* metric not meterable here -> omit (treated as unknown, not zero) */ }
    }));
    // Merge period-scoped usage counters (usage-based metrics) for the current billing period.
    try {
      const period = new Date().toISOString().slice(0, 7);
      const r: any = await sql`SELECT metric, used_value FROM usage_counters WHERE tenant_id = ${tenantId} AND billing_period = ${period}`.execute(this.db);
      for (const row of (r.rows as any[])) if (out[String(row.metric)] === undefined) out[String(row.metric)] = Number(row.used_value);
    } catch { /* no usage counters yet -> leave metrics unmetered */ }
    return out;
  }

  async recordUsage(tenantId: string, metric: string, amount: number, period: string): Promise<number> {
    const r: any = await sql`INSERT INTO usage_counters (tenant_id, metric, billing_period, used_value, updated_at)
              VALUES (${tenantId}, ${metric}, ${period}, GREATEST(0, ${amount}), now())
              ON CONFLICT (tenant_id, metric, billing_period) DO UPDATE SET
                used_value = GREATEST(0, usage_counters.used_value + ${amount}), updated_at = now()
              RETURNING used_value`.execute(this.db);
    return Number(r.rows[0].used_value);
  }

  async upsertUtilizationSnapshot(s: { tenants: number; tenantsNear: number; tenantsOver: number; avgMaxPct: number }): Promise<void> {
    await sql`INSERT INTO utilization_snapshots (captured_on, tenants, tenants_near, tenants_over, avg_max_pct)
              VALUES (CURRENT_DATE, ${s.tenants}, ${s.tenantsNear}, ${s.tenantsOver}, ${s.avgMaxPct})
              ON CONFLICT (captured_on) DO UPDATE SET
                tenants = EXCLUDED.tenants, tenants_near = EXCLUDED.tenants_near,
                tenants_over = EXCLUDED.tenants_over, avg_max_pct = EXCLUDED.avg_max_pct`.execute(this.db);
  }

  async getUtilizationTrend(limit: number): Promise<{ capturedOn: string; tenants: number; tenantsNear: number; tenantsOver: number; avgMaxPct: number }[]> {
    const r: any = await sql`SELECT captured_on, tenants, tenants_near, tenants_over, avg_max_pct
                             FROM utilization_snapshots ORDER BY captured_on DESC LIMIT ${limit}`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({
      capturedOn: new Date(x.captured_on).toISOString().slice(0, 10),
      tenants: Number(x.tenants), tenantsNear: Number(x.tenants_near), tenantsOver: Number(x.tenants_over), avgMaxPct: Number(x.avg_max_pct),
    })).reverse(); // chronological
  }

  async upsertLimitOverride(tenantId: string, o: LimitOverrideWrite): Promise<void> {
    await sql`INSERT INTO tenant_plan_limit_overrides (tenant_id, metric, limit_value, enforcement, reason, expires_at, created_by)
              VALUES (${tenantId}, ${o.metric}, ${o.limitValue}, ${o.enforcement}, ${o.reason}, ${o.expiresAt}, ${o.createdBy})
              ON CONFLICT (tenant_id, metric) DO UPDATE SET
                limit_value = EXCLUDED.limit_value, enforcement = EXCLUDED.enforcement, reason = EXCLUDED.reason,
                expires_at = EXCLUDED.expires_at, updated_at = now()`.execute(this.db);
  }

  async deleteLimitOverride(tenantId: string, metric: string): Promise<boolean> {
    const r: any = await sql`DELETE FROM tenant_plan_limit_overrides WHERE tenant_id = ${tenantId} AND metric = ${metric} RETURNING id`.execute(this.db);
    return (r.rows?.length ?? 0) > 0;
  }

  async upsertFeatureOverride(tenantId: string, f: FeatureOverrideWrite): Promise<void> {
    await sql`INSERT INTO tenant_feature_overrides (tenant_id, feature_key, state, reason, expires_at, created_by)
              VALUES (${tenantId}, ${f.featureKey}, ${f.state}, ${f.reason}, ${f.expiresAt}, ${f.createdBy})
              ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
                state = EXCLUDED.state, reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, updated_at = now()`.execute(this.db);
  }

  async deleteFeatureOverride(tenantId: string, featureKey: string): Promise<boolean> {
    const r: any = await sql`DELETE FROM tenant_feature_overrides WHERE tenant_id = ${tenantId} AND feature_key = ${featureKey} RETURNING id`.execute(this.db);
    return (r.rows?.length ?? 0) > 0;
  }

  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    const tenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId) ? entityId : null;
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: tenantId, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'tenant_entitlement', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => { /* auditing must not break the action */ });
  }
}
