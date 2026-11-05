// feature-entitlement.test.ts — BUILD_PLAN Phase 12 (#13): the layered plan-feature decision, the enforcement modes,
// the ONE entitlement service (sources, ≤ 60 s cache, invalidation) and the @RequireFeature guard.
import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import {
  decideFeature, featureEnforcementMode, blocksInMode, EntitlementService, PLAN_FEATURE_KIND, ENTITLEMENT_CACHE_MAX_TTL_MS,
  type FeatureFacts, type FeatureDecision,
} from './feature-entitlement';
import { FeatureEntitlementGuard, RequireFeature, FEATURE_META, featureGateObservations } from './guards/require-feature';

const base: FeatureFacts = { feature: 'memberships', platformStop: null, planMapped: true, planState: null, planManaged: true, addOnGranted: false, override: null, upgradeTo: 'professional' };

describe('decideFeature — platform → override → add-on → plan', () => {
  it('a mapped plan without the feature is NOT_IN_PLAN with the upgrade target; with it, allowed from the plan', () => {
    expect(decideFeature(base)).toMatchObject({ allowed: false, reason: 'NOT_IN_PLAN', upgradeTo: 'professional' });
    expect(decideFeature({ ...base, planState: 'addon' })).toMatchObject({ allowed: false, reason: 'NOT_IN_PLAN', detail: 'Available as an add-on for this plan.' });
    expect(decideFeature({ ...base, planState: 'enabled' })).toEqual({ allowed: true, feature: 'memberships', source: 'plan' });
  });
  it('an active add-on grants it; an override wins both ways', () => {
    expect(decideFeature({ ...base, addOnGranted: true })).toMatchObject({ allowed: true, source: 'add_on' });
    expect(decideFeature({ ...base, override: 'enabled' })).toMatchObject({ allowed: true, source: 'override' });
    expect(decideFeature({ ...base, planState: 'enabled', addOnGranted: true, override: 'disabled' })).toMatchObject({ allowed: false, reason: 'OVERRIDE_DISABLED' });
  });
  it('what the data does not restrict stays open: no / unmapped plan, a feature no plan mentions', () => {
    expect(decideFeature({ ...base, planMapped: false })).toMatchObject({ allowed: true, source: 'unrestricted_plan' });
    expect(decideFeature({ ...base, planManaged: false })).toMatchObject({ allowed: true, source: 'not_plan_managed' });
  });
  it('a platform stop beats everything, and carries no upgrade target', () => {
    expect(decideFeature({ ...base, planState: 'enabled', override: 'enabled', platformStop: { reason: 'KILL_SWITCH_ACTIVE', detail: 'x' } })).toMatchObject({ allowed: false, reason: 'KILL_SWITCH_ACTIVE', upgradeTo: null });
  });
});

describe('enforcement modes', () => {
  const planDeny = decideFeature(base) as Extract<FeatureDecision, { allowed: false }>;
  const stop = decideFeature({ ...base, platformStop: { reason: 'FEATURE_DISABLED', detail: 'x' } });
  it('default is observe; off / enforce are explicit', () => {
    expect(featureEnforcementMode({})).toBe('observe');
    expect(featureEnforcementMode({ FEATURE_ENTITLEMENT_ENFORCEMENT: 'ENFORCE' })).toBe('enforce');
    expect(featureEnforcementMode({ FEATURE_ENTITLEMENT_ENFORCEMENT: 'off' })).toBe('off');
    expect(featureEnforcementMode({ FEATURE_ENTITLEMENT_ENFORCEMENT: 'banana' })).toBe('observe');
  });
  it('observe: plan/override denials pass, platform stops block; enforce: all block; off: none', () => {
    expect(blocksInMode(planDeny, 'observe')).toBe(false);
    expect(blocksInMode(decideFeature({ ...base, override: 'disabled' }), 'observe')).toBe(false);
    expect(blocksInMode(stop, 'observe')).toBe(true);
    expect(blocksInMode(planDeny, 'enforce')).toBe(true);
    expect(blocksInMode(stop, 'off')).toBe(false);
  });
});

describe('EntitlementService — one service, many sources, ≤ 60 s cache', () => {
  it('caches cacheable sources per (salon, kind, key) within the TTL; invalidateTenant drops one salon only', async () => {
    let calls = 0; let now = 0;
    const svc = new EntitlementService([{ kind: PLAN_FEATURE_KIND, cacheable: true, decide: async (t, k) => { calls++; return { allowed: true, feature: k, source: 'plan', t } as any; } }], { clock: () => now });
    await svc.feature('A', 'loyalty'); await svc.feature('A', 'loyalty'); expect(calls).toBe(1);
    await svc.feature('B', 'loyalty'); expect(calls).toBe(2);
    now = ENTITLEMENT_CACHE_MAX_TTL_MS; await svc.feature('A', 'loyalty'); await svc.feature('B', 'loyalty'); expect(calls).toBe(4);   // both expired at 60 s
    svc.invalidateTenant('A'); await svc.feature('A', 'loyalty'); await svc.feature('B', 'loyalty'); expect(calls).toBe(5);   // only A re-read
  });
  it('never caches longer than 60 s, and never caches a usage-metered source', async () => {
    let now = 0; let calls = 0;
    const svc = new EntitlementService([{ kind: 'ai_package', decide: async () => { calls++; return { allowed: true }; } }, { kind: PLAN_FEATURE_KIND, cacheable: true, decide: async () => { calls++; return {}; } }], { ttlMs: 10 * 60_000, clock: () => now });
    await svc.decide('ai_package', 'A', 'x'); await svc.decide('ai_package', 'A', 'x'); expect(calls).toBe(2);
    await svc.feature('A', 'f'); now = 60_001; await svc.feature('A', 'f'); expect(calls).toBe(4);
    await expect(svc.decide('nope', 'A', 'x')).rejects.toThrow(/no source/);
  });
});

function run(feature: string | undefined, ctx: any, svc?: EntitlementService) {
  const handler = () => undefined; const cls = class {};
  if (feature) RequireFeature(feature)(cls);
  const g = new FeatureEntitlementGuard(new Reflector(), svc);
  return g.canActivate({ getHandler: () => handler, getClass: () => cls, switchToHttp: () => ({ getRequest: () => ({ ctx }) }) } as any);
}
const svcWith = (d: Partial<FeatureDecision> | Error) => new EntitlementService([{ kind: PLAN_FEATURE_KIND, decide: async (_t, k) => { if (d instanceof Error) throw d; return { feature: k, ...d } as FeatureDecision; } }]);
const staff = { tenantId: 't1', role: 'OWNER', userId: 'u' };
const withMode = async (mode: string | undefined, fn: () => Promise<unknown>) => { const old = process.env.FEATURE_ENTITLEMENT_ENFORCEMENT; if (mode === undefined) delete process.env.FEATURE_ENTITLEMENT_ENFORCEMENT; else process.env.FEATURE_ENTITLEMENT_ENFORCEMENT = mode; try { return await fn(); } finally { if (old === undefined) delete process.env.FEATURE_ENTITLEMENT_ENFORCEMENT; else process.env.FEATURE_ENTITLEMENT_ENFORCEMENT = old; } };
const caught = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as any; } };

describe('FeatureEntitlementGuard', () => {
  const notInPlan = { allowed: false as const, reason: 'NOT_IN_PLAN' as const, upgradeTo: 'professional', detail: 'x' };
  it('reads @RequireFeature from the controller (class-level) metadata', () => {
    const cls = class {}; RequireFeature('loyalty')(cls); expect(Reflect.getMetadata(FEATURE_META, cls)).toBe('loyalty');
  });
  it('enforce: a plan without the feature → 403 FEATURE_NOT_IN_PLAN { feature, upgradeTo }', async () => {
    const e = await withMode('enforce', () => caught(run('memberships', staff, svcWith(notInPlan)) as Promise<unknown>));
    expect(e?.getStatus?.()).toBe(403);
    expect(e.getResponse()).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', feature: 'memberships', upgradeTo: 'professional', reason: 'NOT_IN_PLAN', details: { feature: 'memberships', upgradeTo: 'professional' } });
  });
  it('observe (default): the same denial is allowed and counted; a platform stop still blocks', async () => {
    featureGateObservations.clear();
    expect(await withMode(undefined, () => run('memberships', staff, svcWith(notInPlan)) as Promise<unknown>)).toBe(true);
    expect(featureGateObservations.get('memberships')?.get('NOT_IN_PLAN')).toBe(1);
    const e = await withMode(undefined, () => caught(run('memberships', staff, svcWith({ allowed: false, reason: 'EMERGENCY_DISABLED', upgradeTo: null, detail: 'x' } as any)) as Promise<unknown>));
    expect(e?.getStatus?.()).toBe(403);
  });
  it('no metadata, no salon, a platform principal, no service, a failing lookup, mode off → pass', async () => {
    await withMode('enforce', async () => {
      expect(await run(undefined, staff, svcWith(notInPlan))).toBe(true);
      expect(await run('memberships', { role: 'CUSTOMER' }, svcWith(notInPlan))).toBe(true);
      expect(await run('memberships', { tenantId: 't1', role: 'SUPER_ADMIN' }, svcWith(notInPlan))).toBe(true);
      expect(await run('memberships', staff, undefined)).toBe(true);
      expect(await run('memberships', staff, svcWith(new Error('db down')))).toBe(true);
    });
    expect(await withMode('off', () => run('memberships', staff, svcWith(notInPlan)) as Promise<unknown>)).toBe(true);
  });
});
