// plans.kysely.repository.ts — real reads + writes for Plans. Reads coerce Postgres BIGINT (returned as string) to
// number (NULL preserved as unlimited). Writes are transactional: createPlan and applyPricingChange each commit as a
// unit, and pricing changes supersede the prior active version (never edit it) so historical terms stay immutable.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PlansDataPort, PlansOverviewData, PlanSnapshot, PlanVersionView, AuditActor } from './plans.repository';
import type { NormalizedCreatePlan, ValidatedPricingChange, PlanLimitChange } from './plan-mutations-core';
import { canMoveToSql } from '@aipowersalon/database';
import { SUBSCRIPTION_PLAN_VERSION } from '../platform-lifecycles';

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export class KyselyPlansRepository implements PlansDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  async getOverviewData(): Promise<PlansOverviewData> {
    const [plansRes, limitsRes, featuresRes, subsRes, overageRes, addOnsRes, trialsRes, promosRes, tenantSubsRes, featAdoptRes, featTenantRes, trendRes] = await Promise.all([
      sql`SELECT id, code, name, subtitle, plan_type, status, monthly_price_cents, annual_price_cents,
                 is_recommended, is_public, display_order
          FROM subscription_plans`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT plan_id, metric, limit_value FROM plan_limits`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT plan_id, COUNT(*)::int AS enabled_count FROM plan_features WHERE state = 'enabled' GROUP BY plan_id`
        .execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT plan, status FROM tenant_subscriptions`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT r.metric, r.unit_price_cents,
                 COALESCE(c.tenants, 0)::int AS tenants, COALESCE(c.revenue_cents, 0) AS revenue_cents
          FROM overage_rules r
          LEFT JOIN (
            SELECT metric, COUNT(DISTINCT tenant_id)::int AS tenants, COALESCE(SUM(amount_cents), 0) AS revenue_cents
            FROM overage_charges WHERE billing_period = to_char(now(), 'YYYY-MM') AND status = 'active'
            GROUP BY metric
          ) c ON c.metric = r.metric
          WHERE r.plan_id IS NULL`
        .execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT a.code, a.name, a.pricing_model, a.unit_price_cents, a.status,
                 COUNT(t.id) FILTER (WHERE t.status = 'active')::int AS tenant_count,
                 COALESCE(SUM(t.price_cents) FILTER (WHERE t.status = 'active'), 0) AS revenue_cents
          FROM plan_add_ons a LEFT JOIN tenant_add_ons t ON t.add_on_id = a.id
          GROUP BY a.id ORDER BY a.display_order`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT d.code, d.name, d.duration_days,
                 COUNT(tt.id) FILTER (WHERE tt.status = 'active')::int AS tenant_count,
                 MIN(tt.ends_at) FILTER (WHERE tt.status = 'active') AS ends_on
          FROM trial_definitions d LEFT JOIN tenant_trials tt ON tt.trial_definition_id = d.id
          WHERE d.status = 'active' GROUP BY d.id ORDER BY d.duration_days`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT p.code, p.name, p.end_date, p.discount_type, p.discount_percent, p.free_months,
                 COUNT(r.id) FILTER (WHERE r.status = 'active')::int AS tenant_count
          FROM promotions p LEFT JOIN promotion_redemptions r ON r.promotion_id = p.id
          WHERE p.status = 'active' GROUP BY p.id`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT ts.tenant_id, COALESCE(t.display_name, t.legal_name, ts.tenant_id::text) AS name,
                 ts.plan, ts.plan_code, ts.monthly_price_cents, ts.status
          FROM tenant_subscriptions ts JOIN tenants t ON t.id = ts.tenant_id`.execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT feature_key, COUNT(*) FILTER (WHERE state = 'enabled')::int AS enabled_plans FROM plan_features GROUP BY feature_key`
        .execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT feature_key, COUNT(*) FILTER (WHERE state = 'enabled')::int AS tenant_enabled FROM tenant_feature_overrides GROUP BY feature_key`
        .execute(this.db).catch(() => ({ rows: [] })),
      sql`SELECT captured_on, tenants, tenants_near, tenants_over, avg_max_pct
          FROM utilization_snapshots ORDER BY captured_on DESC LIMIT 30`.execute(this.db).catch(() => ({ rows: [] })),
    ]);

    const addOns = (addOnsRes.rows as any[]).map((r) => ({
      code: String(r.code), name: String(r.name), pricingModel: String(r.pricing_model),
      unitPriceCents: Number(r.unit_price_cents), status: String(r.status),
      tenantCount: Number(r.tenant_count ?? 0), monthlyRevenueCents: Number(r.revenue_cents ?? 0),
    }));
    const trialsPromotions = [
      ...(trialsRes.rows as any[]).map((r) => ({
        kind: 'trial' as const, code: String(r.code), name: String(r.name),
        tenantCount: Number(r.tenant_count ?? 0), endsOn: r.ends_on ? iso(r.ends_on) : null,
        detail: r.duration_days != null ? `${Number(r.duration_days)}-day trial` : null,
      })),
      ...(promosRes.rows as any[]).map((r) => ({
        kind: 'promotion' as const, code: String(r.code), name: String(r.name),
        tenantCount: Number(r.tenant_count ?? 0), endsOn: r.end_date ? iso(r.end_date) : null,
        detail: r.discount_type === 'percent' ? `${Number(r.discount_percent)}% off` : r.discount_type === 'free_period' ? `${Number(r.free_months)} months free` : 'discount',
      })),
    ];

    return {
      planRows: (plansRes.rows as any[]).map((r) => ({
        id: String(r.id), code: String(r.code), name: String(r.name),
        subtitle: r.subtitle ?? null, plan_type: String(r.plan_type), status: String(r.status),
        monthly_price_cents: Number(r.monthly_price_cents), annual_price_cents: numOrNull(r.annual_price_cents),
        is_recommended: !!r.is_recommended, is_public: !!r.is_public, display_order: Number(r.display_order),
      })),
      limitRows: (limitsRes.rows as any[]).map((r) => ({ plan_id: String(r.plan_id), metric: String(r.metric), limit_value: numOrNull(r.limit_value) })),
      featureCounts: (featuresRes.rows as any[]).map((r) => ({ plan_id: String(r.plan_id), enabled_count: Number(r.enabled_count) })),
      subFacts: (subsRes.rows as any[]).map((r) => ({ plan: String(r.plan ?? ''), status: String(r.status ?? '') })),
      overageRows: (overageRes.rows as any[]).map((r) => ({ metric: String(r.metric), unit_price_cents: Number(r.unit_price_cents), tenants: Number(r.tenants ?? 0), revenue_cents: Number(r.revenue_cents ?? 0) })),
      addOns,
      trialsPromotions,
      tenantSubscriptions: (tenantSubsRes.rows as any[]).map((r) => ({
        tenantId: String(r.tenant_id), name: String(r.name),
        planText: r.plan ?? null, planCode: r.plan_code ?? null,
        monthlyPriceCents: r.monthly_price_cents == null ? null : Number(r.monthly_price_cents), status: r.status ?? null,
      })),
      featureAdoption: (() => {
        const tenantByKey = new Map<string, number>();
        for (const r of (featTenantRes.rows as any[])) tenantByKey.set(String(r.feature_key), Number(r.tenant_enabled ?? 0));
        return (featAdoptRes.rows as any[]).map((r) => ({ featureKey: String(r.feature_key), enabledPlans: Number(r.enabled_plans ?? 0), tenantEnabled: tenantByKey.get(String(r.feature_key)) ?? 0 }));
      })(),
      utilizationTrend: (trendRes.rows as any[]).map((r) => ({
        capturedOn: new Date(r.captured_on).toISOString().slice(0, 10),
        tenants: Number(r.tenants), tenantsNear: Number(r.tenants_near), tenantsOver: Number(r.tenants_over), avgMaxPct: Number(r.avg_max_pct),
      })).reverse(),
    };
  }

  async planKeyExists(code: string, name: string): Promise<{ codeExists: boolean; nameExists: boolean }> {
    const r: any = await sql`SELECT
      EXISTS(SELECT 1 FROM subscription_plans WHERE lower(code) = lower(${code})) AS code_exists,
      EXISTS(SELECT 1 FROM subscription_plans WHERE lower(name) = lower(${name})) AS name_exists`.execute(this.db);
    return { codeExists: !!r.rows[0]?.code_exists, nameExists: !!r.rows[0]?.name_exists };
  }

  async getPlanSnapshot(id: string): Promise<PlanSnapshot | null> {
    const p: any = await sql`SELECT id, code, name, monthly_price_cents, annual_price_cents, setup_fee_cents, currency, billing_interval
                             FROM subscription_plans WHERE id = ${id}`.execute(this.db);
    if (!p.rows.length) return null;
    const row = p.rows[0];
    const lims: any = await sql`SELECT metric, limit_value FROM plan_limits WHERE plan_id = ${id}`.execute(this.db);
    const feats: any = await sql`SELECT feature_key, state FROM plan_features WHERE plan_id = ${id}`.execute(this.db);
    return {
      id: String(row.id), code: String(row.code), name: String(row.name),
      monthly_price_cents: Number(row.monthly_price_cents), annual_price_cents: numOrNull(row.annual_price_cents),
      setup_fee_cents: Number(row.setup_fee_cents), currency: String(row.currency), billing_interval: String(row.billing_interval),
      limits: (lims.rows as any[]).map((r) => ({ metric: String(r.metric), limit_value: numOrNull(r.limit_value) })),
      features: (feats.rows as any[]).map((r) => ({ feature_key: String(r.feature_key), state: String(r.state) })),
    };
  }

  async createPlan(n: NormalizedCreatePlan, createdBy: string | null): Promise<string> {
    return await this.db.transaction().execute(async (trx) => {
      const ins: any = await trx.insertInto('subscription_plans').values({
        code: n.code, name: n.name, subtitle: n.subtitle, description: n.description,
        plan_type: n.plan_type, status: n.status,
        monthly_price_cents: n.monthly_price_cents, annual_price_cents: n.annual_price_cents, setup_fee_cents: n.setup_fee_cents,
        currency: n.currency, billing_interval: n.billing_interval,
        is_recommended: n.is_recommended, is_public: n.is_public, display_order: n.display_order,
      }).returning('id').executeTakeFirstOrThrow();
      const planId = String(ins.id);
      if (n.limits.length) {
        await trx.insertInto('plan_limits').values(n.limits.map((l) => ({ plan_id: planId, metric: l.metric, limit_value: l.limit_value }))).execute();
      }
      if (n.features.length) {
        await trx.insertInto('plan_features').values(n.features.map((f) => ({ plan_id: planId, feature_key: f.feature_key, state: f.state }))).execute();
      }
      const limitsObj = Object.fromEntries(n.limits.map((l) => [l.metric, l.limit_value]));
      const featuresArr = n.features.map((f) => ({ feature_key: f.feature_key, state: f.state }));
      await sql`INSERT INTO subscription_plan_versions
        (plan_id, version_number, monthly_price_cents, annual_price_cents, setup_fee_cents, currency, billing_interval, limits_snapshot, features_snapshot, status, change_reason, created_by)
        VALUES (${planId}, 1, ${n.monthly_price_cents}, ${n.annual_price_cents}, ${n.setup_fee_cents}, ${n.currency}, ${n.billing_interval},
                ${JSON.stringify(limitsObj)}::jsonb, ${JSON.stringify(featuresArr)}::jsonb, 'active', 'Initial version', ${createdBy})`.execute(trx);
      return planId;
    });
  }

  async updatePlanDetails(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const rows: any = await this.db.updateTable('subscription_plans')
      .set({ ...patch, updated_at: new Date() }).where('id', '=', id).returning('id').execute();
    return Array.isArray(rows) && rows.length > 0;
  }

  async getMaxVersion(planId: string): Promise<number | null> {
    const r: any = await sql`SELECT MAX(version_number) AS m FROM subscription_plan_versions WHERE plan_id = ${planId}`.execute(this.db);
    const m = r.rows[0]?.m;
    return m === null || m === undefined ? null : Number(m);
  }

  async applyPricingChange(planId: string, v: ValidatedPricingChange, snapshot: PlanSnapshot, versionNumber: number, createdBy: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`UPDATE subscription_plan_versions SET status = 'superseded', end_date = now()
                WHERE plan_id = ${planId} AND status = 'active' AND ${canMoveToSql(SUBSCRIPTION_PLAN_VERSION, 'superseded')}`.execute(trx);
      const limitsObj = Object.fromEntries(snapshot.limits.map((l) => [l.metric, l.limit_value]));
      const featuresArr = snapshot.features.map((f) => ({ feature_key: f.feature_key, state: f.state }));
      await sql`INSERT INTO subscription_plan_versions
        (plan_id, version_number, monthly_price_cents, annual_price_cents, setup_fee_cents, currency, billing_interval, limits_snapshot, features_snapshot, status, effective_from, change_reason, created_by)
        VALUES (${planId}, ${versionNumber}, ${v.monthlyPriceCents}, ${v.annualPriceCents}, ${snapshot.setup_fee_cents}, ${snapshot.currency}, ${snapshot.billing_interval},
                ${JSON.stringify(limitsObj)}::jsonb, ${JSON.stringify(featuresArr)}::jsonb, 'active', ${v.effectiveFrom.toISOString()}, ${v.reason}, ${createdBy})`.execute(trx);
      await sql`UPDATE subscription_plans SET monthly_price_cents = ${v.monthlyPriceCents}, annual_price_cents = ${v.annualPriceCents}, updated_at = now()
                WHERE id = ${planId}`.execute(trx);
    });
  }

  async listVersions(planId: string): Promise<PlanVersionView[]> {
    const r: any = await sql`SELECT id, version_number, monthly_price_cents, annual_price_cents, status, effective_from, end_date, change_reason, created_at
                             FROM subscription_plan_versions WHERE plan_id = ${planId} ORDER BY version_number DESC`.execute(this.db);
    return (r.rows as any[]).map((row) => ({
      id: String(row.id), versionNumber: Number(row.version_number), monthlyPriceCents: Number(row.monthly_price_cents), annualPriceCents: numOrNull(row.annual_price_cents),
      status: String(row.status), effectiveFrom: iso(row.effective_from), endDate: row.end_date ? iso(row.end_date) : null,
      changeReason: row.change_reason ?? null, createdAt: iso(row.created_at),
    }));
  }

  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    await this.db.insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'subscription_plan', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => { /* auditing must not break the action */ });
  }

  async updatePlanLimits(planId: string, changes: PlanLimitChange[]): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      for (const c of changes) {
        const sets = [sql`limit_value = ${c.limitValue}`];
        if (c.enforcement !== undefined) sets.push(sql`enforcement = ${c.enforcement}`);
        if (c.overageAllowed !== undefined) sets.push(sql`overage_allowed = ${c.overageAllowed}`);
        if (c.overagePriceCents !== undefined) sets.push(sql`overage_price_cents = ${c.overagePriceCents}`);
        const upd: any = await sql`UPDATE plan_limits SET ${sql.join(sets, sql`, `)} WHERE plan_id = ${planId} AND metric = ${c.metric} RETURNING id`.execute(trx);
        if (upd.rows.length === 0) {
          await sql`INSERT INTO plan_limits (id, plan_id, metric, limit_value, enforcement, overage_allowed, overage_price_cents)
                    VALUES (gen_random_uuid(), ${planId}, ${c.metric}, ${c.limitValue}, ${c.enforcement ?? 'hard'}, ${c.overageAllowed ?? false}, ${c.overagePriceCents ?? null})`.execute(trx);
        }
      }
    });
  }
}
