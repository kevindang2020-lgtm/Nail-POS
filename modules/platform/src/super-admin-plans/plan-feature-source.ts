// plan-feature-source.ts — BUILD_PLAN Phase 12 (#13): the 'plan_feature' source of the ONE EntitlementService.
//
// Reads, for one salon and one feature key, exactly the facts the layered decision needs (decideFeature in
// @aipowersalon/permissions) — and reads them with the SAME rules the rest of the plan system already uses:
//   • the active plan: tenant_subscriptions (status active, latest period), mapped to the catalog by code OR name —
//     KyselyEntitlementsRepo.getActivePlanText + mapCatalogPlan; an unmapped / missing plan is NOT restricted by plan
//   • the plan's state: plan_features (enabled | available | addon | unavailable)
//   • plan-managed: some catalog plan has a plan_features row for the key
//   • add-on: an ACTIVE tenant_add_ons row whose plan_add_ons.feature_key is the key (migration 555), not expired
//   • override: tenant_feature_overrides, not expired (EntitlementsService.setFeatureOverride writes it)
//   • platform stops: the feature registry's status / kill switch / rollout (FeatureRegistry.platformStop)
//   • upgradeTo: the lowest active catalog plan (display order, then price) that includes the key
// One round trip for the plan facts; the registry adds at most three small reads.
import { sql } from 'kysely';
import { decideFeature, PLAN_FEATURE_KIND, EntitlementService, type EntitlementSource, type FeatureDecision, type FeatureFacts, type PlatformStop } from '@aipowersalon/permissions';

export interface PlatformStopPort { platformStop(tenantId: string, featureKey: string): Promise<PlatformStop | null> }

export async function loadFeatureFacts(db: any, tenantId: string, featureKey: string, registry: PlatformStopPort | null): Promise<FeatureFacts> {
  const r: any = (await sql`
    WITH sub AS (
      SELECT plan FROM tenant_subscriptions WHERE tenant_id = ${tenantId} AND lower(status) = 'active'
      ORDER BY current_period_end DESC NULLS LAST LIMIT 1
    ), cat AS (
      SELECT p.id FROM subscription_plans p, sub WHERE lower(p.code) = lower(sub.plan) OR lower(p.name) = lower(sub.plan) LIMIT 1
    )
    SELECT
      EXISTS (SELECT 1 FROM cat) AS plan_mapped,
      (SELECT pf.state FROM plan_features pf, cat WHERE pf.plan_id = cat.id AND pf.feature_key = ${featureKey}) AS plan_state,
      EXISTS (SELECT 1 FROM plan_features WHERE feature_key = ${featureKey}) AS plan_managed,
      EXISTS (SELECT 1 FROM tenant_add_ons ta JOIN plan_add_ons a ON a.id = ta.add_on_id
              WHERE ta.tenant_id = ${tenantId} AND lower(ta.status) = 'active' AND a.feature_key = ${featureKey}
                AND (a.expires_at IS NULL OR a.expires_at > now())) AS add_on,
      (SELECT o.state FROM tenant_feature_overrides o WHERE o.tenant_id = ${tenantId} AND o.feature_key = ${featureKey}
         AND (o.expires_at IS NULL OR o.expires_at > now()) LIMIT 1) AS override_state,
      (SELECT p.code FROM subscription_plans p JOIN plan_features pf ON pf.plan_id = p.id
        WHERE pf.feature_key = ${featureKey} AND pf.state = 'enabled' AND lower(p.status) = 'active'
        ORDER BY p.display_order, p.monthly_price_cents LIMIT 1) AS upgrade_to`.execute(db)).rows[0] ?? {};
  const override = r.override_state === 'enabled' || r.override_state === 'disabled' ? r.override_state : null;
  return {
    feature: featureKey,
    platformStop: registry ? await registry.platformStop(tenantId, featureKey) : null,
    planMapped: r.plan_mapped === true,
    planState: r.plan_state != null ? String(r.plan_state) : null,
    planManaged: r.plan_managed === true,
    addOnGranted: r.add_on === true,
    override,
    upgradeTo: r.upgrade_to != null ? String(r.upgrade_to) : null,
  };
}

export class PlanFeatureSource implements EntitlementSource<FeatureDecision> {
  readonly kind = PLAN_FEATURE_KIND;
  readonly cacheable = true;
  constructor(private readonly db: any, private readonly registry: PlatformStopPort | null) {}
  async decide(tenantId: string, featureKey: string): Promise<FeatureDecision> {
    return decideFeature(await loadFeatureFacts(this.db, tenantId, featureKey, this.registry));
  }
}

/** The ONE EntitlementService, with its plan-feature source (the AI package and SMS verification sources register on it). */
export function createEntitlementService(db: any, registry: PlatformStopPort | null): EntitlementService {
  return new EntitlementService(db ? [new PlanFeatureSource(db, registry)] : []);
}

/** Wrap a service's write methods so every change of a salon's plan / add-ons / overrides drops that salon's cached
 *  entitlement answers at once in this process (other processes: within the ≤ 60 s TTL). `-1` = clear every salon. */
export function invalidateOnWrite<T extends object>(svc: T, gate: EntitlementService | null | undefined, tenantArg: Partial<Record<keyof T, number>>): T {
  if (!gate) return svc;
  for (const [name, idx] of Object.entries(tenantArg) as [string, number][]) {
    const orig = (svc as any)[name];
    if (typeof orig !== 'function') continue;
    (svc as any)[name] = async (...args: unknown[]) => {
      try { return await orig.apply(svc, args); }
      finally { if (idx < 0) gate.clear(); else if (typeof args[idx] === 'string') gate.invalidateTenant(args[idx] as string); }
    };
  }
  return svc;
}
