// feature-entitlement.ts — BUILD_PLAN Phase 12 (#13): the ONE "may this salon use this feature?" decision, and the
// entitlement service every gate asks (the plan-feature guard, the AI package guard, the SMS verification check).
//
// Framework-free. The guard that reads @RequireFeature is ./guards/require-feature.ts; the plan / add-on / override /
// platform-registry reads are the 'plan_feature' source in @aipowersalon/platform; the AI package source lives in
// @aipowersalon/ai and the SMS verification source in @aipowersalon/communications.
//
// ── The rule that keeps every salon's access (the Phase 12 hard rule) ───────────────────────────────────────────
// Until this guard existed, NO route checked the plan's features: every salon could use everything. Revoking a feature a
// salon uses today is a pricing decision, not a refactor, so the plan layer ships in OBSERVE mode (like the AI guard):
//
//   FEATURE_ENTITLEMENT_ENFORCEMENT=off       the guard does nothing
//   FEATURE_ENTITLEMENT_ENFORCEMENT=observe   (DEFAULT) a plan / override denial is COUNTED and allowed; only the
//                                             platform's own stops (registry status DISABLED / DEPRECATED /
//                                             EMERGENCY_DISABLED, a kill switch, a killed rollout flag) are enforced —
//                                             none is set today, and each is a deliberate Super Admin action
//   FEATURE_ENTITLEMENT_ENFORCEMENT=enforce   every denial answers 403 FEATURE_NOT_IN_PLAN { feature, upgradeTo }
//
// And in every mode the plan layer only restricts what the plan data actually restricts:
//   • a salon with no active subscription, or a plan text that is not in the catalog (legacy / pilot plans), is NOT
//     restricted by plan — the rule plan LIMITS and display advertising already follow;
//   • a feature no catalog plan mentions is not plan-managed — nothing to restrict;
//   • an active add-on whose plan_add_ons.feature_key names the feature grants it (migration 555);
//   • a Super Admin override (tenant_feature_overrides) wins over the plan: enabled grants, disabled denies.
export type FeatureDenyReason =
  | 'NOT_IN_PLAN' | 'OVERRIDE_DISABLED'                                         // plan layer (observed unless enforce)
  | 'FEATURE_DISABLED' | 'FEATURE_DEPRECATED' | 'EMERGENCY_DISABLED' | 'KILL_SWITCH_ACTIVE' | 'FLAG_KILLED' | 'NOT_IN_ROLLOUT';   // platform layer
export type FeatureGrantSource = 'plan' | 'add_on' | 'override' | 'unrestricted_plan' | 'not_plan_managed';

export type FeatureDecision =
  | { allowed: true; feature: string; source: FeatureGrantSource }
  | { allowed: false; feature: string; reason: FeatureDenyReason; upgradeTo: string | null; detail: string };

/** The platform layer's verdict (registry status, kill switch, rollout) — null when it lets the feature through. */
export interface PlatformStop { reason: Extract<FeatureDenyReason, 'FEATURE_DISABLED' | 'FEATURE_DEPRECATED' | 'EMERGENCY_DISABLED' | 'KILL_SWITCH_ACTIVE' | 'FLAG_KILLED' | 'NOT_IN_ROLLOUT'>; detail: string }

/** Everything the decision needs, as stored right now. */
export interface FeatureFacts {
  feature: string;
  platformStop: PlatformStop | null;
  /** the salon's active plan is a catalog plan (false: no active subscription, or an unmapped legacy plan text) */
  planMapped: boolean;
  /** plan_features.state for this salon's plan (enabled | available | addon | unavailable), null when no row */
  planState: string | null;
  /** some catalog plan has a plan_features row for this key (else the feature is not plan-managed) */
  planManaged: boolean;
  /** an ACTIVE tenant add-on grants this feature */
  addOnGranted: boolean;
  /** the salon's live Super Admin override */
  override: 'enabled' | 'disabled' | null;
  /** the lowest catalog plan that includes the feature (for the upgrade prompt) */
  upgradeTo: string | null;
}

export const PLATFORM_STOP_REASONS: readonly FeatureDenyReason[] = ['FEATURE_DISABLED', 'FEATURE_DEPRECATED', 'EMERGENCY_DISABLED', 'KILL_SWITCH_ACTIVE', 'FLAG_KILLED', 'NOT_IN_ROLLOUT'];
export const isPlatformStop = (r: FeatureDenyReason): boolean => PLATFORM_STOP_REASONS.includes(r);

/** Pure: the layered decision (platform → override → add-on → plan). */
export function decideFeature(f: FeatureFacts): FeatureDecision {
  const deny = (reason: FeatureDenyReason, detail: string): FeatureDecision => ({ allowed: false, feature: f.feature, reason, upgradeTo: isPlatformStop(reason) ? null : f.upgradeTo, detail });
  if (f.platformStop) return deny(f.platformStop.reason, f.platformStop.detail);
  if (f.override === 'disabled') return deny('OVERRIDE_DISABLED', 'Switched off for this salon by the platform.');
  if (f.override === 'enabled') return { allowed: true, feature: f.feature, source: 'override' };
  if (f.addOnGranted) return { allowed: true, feature: f.feature, source: 'add_on' };
  if (!f.planMapped) return { allowed: true, feature: f.feature, source: 'unrestricted_plan' };
  if (!f.planManaged) return { allowed: true, feature: f.feature, source: 'not_plan_managed' };
  if (f.planState === 'enabled') return { allowed: true, feature: f.feature, source: 'plan' };
  return deny('NOT_IN_PLAN', f.planState === 'addon' ? 'Available as an add-on for this plan.' : 'Not included in this salon\'s plan.');
}

export type FeatureEnforcementMode = 'off' | 'observe' | 'enforce';
/** Default `observe`: nobody's access changes until someone deliberately chooses `enforce`. */
export function featureEnforcementMode(env: Record<string, string | undefined> = process.env): FeatureEnforcementMode {
  const v = String(env.FEATURE_ENTITLEMENT_ENFORCEMENT ?? '').trim().toLowerCase();
  return v === 'off' || v === 'enforce' ? v : 'observe';
}

/** Does this denial block the request in this mode? (platform stops always do, except in `off`) */
export function blocksInMode(d: FeatureDecision, mode: FeatureEnforcementMode): boolean {
  if (d.allowed || mode === 'off') return false;
  return mode === 'enforce' || isPlatformStop(d.reason);
}

export const FEATURE_NOT_IN_PLAN = 'FEATURE_NOT_IN_PLAN';

// ── the ONE entitlement service ──────────────────────────────────────────────────────────────────────────────────
/** A source answers one KIND of entitlement. Sources own their storage; the service owns caching and the registry. */
export interface EntitlementSource<D = unknown, C = unknown> {
  readonly kind: string;
  decide(tenantId: string, key: string, ctx?: C): Promise<D>;
  /** cacheable sources' answers are kept ≤ ttl per (tenant, key); usage-metered sources (AI, SMS) set false */
  readonly cacheable?: boolean;
}

export interface EntitlementServiceOptions { ttlMs?: number; clock?: () => number }
export const ENTITLEMENT_CACHE_MAX_TTL_MS = 60_000;

/** The DI token the API binds the EntitlementService under (a string, like TENANT_CACHE). */
export const ENTITLEMENT_SERVICE = 'ENTITLEMENT_SERVICE';
export const PLAN_FEATURE_KIND = 'plan_feature';

export class EntitlementService {
  private readonly sources = new Map<string, EntitlementSource<any, any>>();
  private readonly cache = new Map<string, { at: number; v: unknown }>();
  private readonly ttlMs: number;
  private readonly clock: () => number;
  constructor(sources: EntitlementSource<any, any>[] = [], o: EntitlementServiceOptions = {}) {
    this.ttlMs = Math.min(ENTITLEMENT_CACHE_MAX_TTL_MS, Math.max(0, o.ttlMs ?? ENTITLEMENT_CACHE_MAX_TTL_MS));
    this.clock = o.clock ?? (() => Date.now());
    for (const s of sources) this.register(s);
  }
  register(s: EntitlementSource<any, any>): this { this.sources.set(s.kind, s); return this; }
  has(kind: string): boolean { return this.sources.has(kind); }

  async decide<D = unknown, C = unknown>(kind: string, tenantId: string, key: string, ctx?: C): Promise<D> {
    const s = this.sources.get(kind);
    if (!s) throw new Error(`entitlements: no source for kind '${kind}'`);
    if (!s.cacheable || this.ttlMs === 0) return s.decide(tenantId, key, ctx);
    const k = `${tenantId}\u0000${kind}\u0000${key}`; const now = this.clock();
    const hit = this.cache.get(k);
    if (hit && now - hit.at < this.ttlMs) return hit.v as D;
    const v = await s.decide(tenantId, key, ctx);
    this.cache.set(k, { at: now, v });
    return v as D;
  }

  /** The plan-feature decision (plan + add-ons + overrides + platform registry), cached ≤ 60 s per salon. */
  feature(tenantId: string, featureKey: string): Promise<FeatureDecision> { return this.decide<FeatureDecision>(PLAN_FEATURE_KIND, tenantId, featureKey); }

  /** Drop a salon's cached answers — called by every in-process write that changes a plan, add-on or override. */
  invalidateTenant(tenantId: string): void { for (const k of this.cache.keys()) if (k.startsWith(`${tenantId}\u0000`)) this.cache.delete(k); }
  clear(): void { this.cache.clear(); }
}

// ── which routes belong to a plan-gated feature (check:api-contract reads this) ───────────────────────────────────
/**
 * The plan features some catalog plan does NOT include (migration 174: starter has the base six; professional adds
 * memberships / loyalty / communications / marketing / smart_reminders; …), mapped to the staff route prefixes that ARE
 * the feature. Every route under a prefix must carry @RequireFeature(<that key>) — check:api-contract fails otherwise,
 * so a new route in a plan-gated module cannot ship ungated.
 *
 * Deliberately NOT here:
 *   • the base features every plan includes (pos_core, booking, check_in, queue, payments, reports) — nothing to gate;
 *   • the AI features (ai_receptionist, ai_insights, …) — sold as AI PACKAGES, gated by @RequiresAiPackage (the
 *     'ai_package' source of the same EntitlementService); gating them on the plan too would double-charge the add-on;
 *   • customer_display_ads (every plan) — its service resolves the same layers itself and answers an honest
 *     "not available" state the screen renders, rather than a 403;
 *   • automation / multi_location / advanced_security / integrations / priority_support — no route family IS the
 *     feature today (they are limits, settings or support levels), so there is no route to gate.
 */
export const PLAN_FEATURE_ROUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  memberships: ['/pos/memberships'],
  loyalty: ['/pos/loyalty'],
  marketing: ['/pos/campaigns', '/pos/marketing-report'],
  communications: ['/pos/communications'],
  smart_reminders: ['/pos/reminders'],
});

/** The plan feature a route path belongs to (null = not plan-gated). */
export function planFeatureForPath(path: string): string | null {
  const p = path.startsWith('/') ? path : `/${path}`;
  for (const [feature, prefixes] of Object.entries(PLAN_FEATURE_ROUTES)) {
    if (prefixes.some((x) => p === x || p.startsWith(`${x}/`))) return feature;
  }
  return null;
}
