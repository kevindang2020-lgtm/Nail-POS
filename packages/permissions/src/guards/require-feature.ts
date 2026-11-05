// require-feature.ts — BUILD_PLAN Phase 12 (#13): @RequireFeature('feature_key') and the ONE plan-feature guard.
//
// Registered as a global APP_GUARD; it does nothing on a handler (or controller) without @RequireFeature, so it can
// never gate a public route, a webhook or a Super Admin surface by accident. The decision comes from the ONE
// EntitlementService (../feature-entitlement.ts) — plan + add-ons + overrides + the platform feature registry — and the
// enforcement mode decides what a denial does (observe by default: counted, allowed; see feature-entitlement.ts).
//
// A denial that blocks answers 403 { code: FEATURE_NOT_IN_PLAN, feature, upgradeTo, reason } — the AI guard's shape
// (403 + what to upgrade to), so a screen handles both the same way.
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isPlatformPrincipal } from '../principal';
import {
  EntitlementService, ENTITLEMENT_SERVICE, FEATURE_NOT_IN_PLAN, blocksInMode, featureEnforcementMode, type FeatureDecision,
} from '../feature-entitlement';

export const FEATURE_META = 'requiredPlanFeature';
/** Declare the plan feature a handler (or every handler of a controller) belongs to. */
export const RequireFeature = (featureKey: string) => SetMetadata(FEATURE_META, featureKey);

/** Observed (would-block) denials, for the metrics endpoint and the gate-preview report: feature → reason → count. */
export const featureGateObservations = new Map<string, Map<string, number>>();
function observe(d: Extract<FeatureDecision, { allowed: false }>): void {
  const byReason = featureGateObservations.get(d.feature) ?? new Map<string, number>();
  byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
  featureGateObservations.set(d.feature, byReason);
}

export function featureNotInPlan(d: Extract<FeatureDecision, { allowed: false }>): ForbiddenException {
  return new ForbiddenException({
    ok: false, code: FEATURE_NOT_IN_PLAN,
    message: d.reason === 'NOT_IN_PLAN' ? 'This feature is not included in your plan.' : d.reason === 'OVERRIDE_DISABLED' ? 'This feature is switched off for your salon.' : 'This feature is not available right now.',
    feature: d.feature, upgradeTo: d.upgradeTo, reason: d.reason,
    details: { feature: d.feature, upgradeTo: d.upgradeTo, reason: d.reason },
  });
}

@Injectable()
export class FeatureEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // Optional: with no entitlement service bound (dev without a DB, unit wiring) the guard PASSES — a missing
    // dependency must never lock a salon out of a feature it pays for.
    @Optional() @Inject(ENTITLEMENT_SERVICE) private readonly entitlements?: EntitlementService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<string | undefined>(FEATURE_META, [ctx.getHandler(), ctx.getClass()]);
    if (!feature) return true;
    const mode = featureEnforcementMode();
    if (mode === 'off' || !this.entitlements) return true;
    const c = ctx.switchToHttp().getRequest()?.ctx ?? {};
    // Platform staff are never gated on a salon's plan (support must work on a lapsed salon); no salon → nothing to check.
    if (!c.tenantId || isPlatformPrincipal(c)) return true;
    let d: FeatureDecision;
    try { d = await this.entitlements.feature(String(c.tenantId), feature); }
    catch { return true; }   // the check itself failed (DB blip): FAIL OPEN — a paying salon must not lose a feature to a timeout
    if (d.allowed) return true;
    if (!blocksInMode(d, mode)) { observe(d); return true; }
    throw featureNotInPlan(d);
  }
}
