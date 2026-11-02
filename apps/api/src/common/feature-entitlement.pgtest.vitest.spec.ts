// BUILD_PLAN Phase 12 (#13) on the real migrated schema: the ONE plan-feature guard (@RequireFeature) and its
// EntitlementService source (plan + add-ons + overrides + platform registry).
//
// The hard rule first: EVERY CURRENT PLAN KEEPS ITS CURRENT ACCESS. Before this guard no route checked the plan's
// features, so every salon — on any catalog plan, an unmapped legacy plan, or no subscription at all — could open every
// plan-gated route. In the default mode that must still be true for every route the route table marks with
// @RequireFeature. Then: what `enforce` does with the same data (403 FEATURE_NOT_IN_PLAN + upgradeTo), add-ons,
// overrides, the platform stop that blocks in every mode, and the cache invalidation on an override write.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { sql } from 'kysely';
import { Reflector } from '@nestjs/core';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PLAN_FEATURE_ROUTES, type EntitlementService } from '@aipowersalon/permissions';
import { FeatureEntitlementGuard, RequireFeature } from '@aipowersalon/permissions/guards';
import { createEntitlementService, FeatureRegistry, EntitlementsService, invalidateOnWrite, KyselyEntitlementsRepo } from '@aipowersalon/platform';

const require = createRequire(import.meta.url);
const { routes } = require('../../scripts/audit-routes.js');

let db: any; let gate: EntitlementService;
const id = (n: number) => `9a9a9a9a-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenants: Record<string, string> = {};   // label → tenant id
let plans: string[] = [];

async function tenant(label: string, plan: string | null, n: number) {
  const t = id(n); tenants[label] = t;
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values (${t}, ${label}, ${label}, ${'fe-' + n}, ${'FE' + n})`.execute(db);
  if (plan) await sql`insert into tenant_subscriptions (tenant_id, plan, status) values (${t}, ${plan}, 'active')`.execute(db);
  return t;
}
const withMode = async <T>(mode: string | undefined, fn: () => Promise<T>): Promise<T> => {
  const old = process.env.FEATURE_ENTITLEMENT_ENFORCEMENT;
  if (mode === undefined) delete process.env.FEATURE_ENTITLEMENT_ENFORCEMENT; else process.env.FEATURE_ENTITLEMENT_ENFORCEMENT = mode;
  try { return await fn(); } finally { if (old === undefined) delete process.env.FEATURE_ENTITLEMENT_ENFORCEMENT; else process.env.FEATURE_ENTITLEMENT_ENFORCEMENT = old; }
};
/** Run the real guard for a salon on a handler of a controller marked @RequireFeature(feature): true, or the thrown error. */
async function call(feature: string, tenantId: string, svc: EntitlementService = gate): Promise<true | any> {
  const cls = class {}; RequireFeature(feature)(cls); const handler = () => undefined;
  try {
    return await new FeatureEntitlementGuard(new Reflector(), svc).canActivate({ getHandler: () => handler, getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ ctx: { tenantId, role: 'OWNER', userId: id(999) } }) }) } as any);
  } catch (e) { return e; }
}
const fresh = () => createEntitlementService(db, new FeatureRegistry(db));

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  plans = (await sql<any>`select code from subscription_plans order by display_order`.execute(db)).rows.map((r: any) => r.code);
  let n = 1;
  for (const p of plans) await tenant(`plan:${p}`, p, n++);
  await tenant('unmapped-legacy-plan', 'Pilot Salon Plan 2025', n++);
  await tenant('no-subscription', null, n++);
  await tenant('starter-with-addon', 'starter', n++);
  await tenant('starter-with-override', 'starter', n++);
  await tenant('unlimited-override-off', 'unlimited', n++);
  gate = fresh();
});
afterEach(() => gate.clear());

describe('the route table', () => {
  it('every plan-gated feature has routes, and every one of them names a feature some catalog plan does not include', async () => {
    const gated = routes.filter((r: any) => [...r.classDecorators, ...r.decorators].some((d: any) => d.name === 'RequireFeature'));
    const keys = [...new Set(gated.map((r: any) => /['"`]([^'"`]+)/.exec([...r.decorators, ...r.classDecorators].find((d: any) => d.name === 'RequireFeature').args)![1]))].sort();
    expect(keys).toEqual(Object.keys(PLAN_FEATURE_ROUTES).sort());
    expect(gated.length).toBeGreaterThanOrEqual(30);
    for (const k of keys) {
      const notIn = (await sql<any>`select p.code from subscription_plans p where not exists (select 1 from plan_features f where f.plan_id = p.id and f.feature_key = ${k} and f.state = 'enabled')`.execute(db)).rows;
      expect(notIn.length, `${k} is in every plan — nothing to gate`).toBeGreaterThan(0);
    }
  });
});

describe('HARD RULE — every current plan keeps its current access (default mode)', () => {
  it('every catalog plan, an unmapped legacy plan and no subscription: every @RequireFeature route still opens', async () => {
    expect(plans).toEqual(['starter', 'professional', 'premium', 'enterprise', 'unlimited']);
    await withMode(undefined, async () => {
      for (const [label, t] of Object.entries(tenants)) {
        for (const feature of Object.keys(PLAN_FEATURE_ROUTES)) expect(await call(feature, t), `${label} / ${feature}`).toBe(true);
      }
    });
  });
});

describe('enforce — what the plan data says', () => {
  it('a plan without the feature → 403 FEATURE_NOT_IN_PLAN with the lowest plan that has it; a plan with it → allowed', async () => {
    await withMode('enforce', async () => {
      const e = await call('memberships', tenants['plan:starter']);
      expect(e.getStatus()).toBe(403);
      expect(e.getResponse()).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', feature: 'memberships', upgradeTo: 'professional', reason: 'NOT_IN_PLAN' });
      for (const p of ['professional', 'premium', 'enterprise', 'unlimited']) for (const f of Object.keys(PLAN_FEATURE_ROUTES)) expect(await call(f, tenants[`plan:${p}`]), `${p}/${f}`).toBe(true);
      // what the data does not restrict stays open even when enforcing
      expect(await call('memberships', tenants['unmapped-legacy-plan'])).toBe(true);
      expect(await call('memberships', tenants['no-subscription'])).toBe(true);
      expect(await call('teleportation', tenants['plan:starter'])).toBe(true);   // no plan mentions it: not plan-managed
    });
  });
  it('an active add-on whose feature_key names the feature grants it (migration 555); cancelling it takes it away', async () => {
    const t = tenants['starter-with-addon'];
    expect((await sql<any>`select feature_key from plan_add_ons where code = 'marketing_suite'`.execute(db)).rows[0].feature_key).toBe('marketing');
    await withMode('enforce', async () => {
      expect((await call('marketing', t)).getStatus()).toBe(403);
      await sql`insert into tenant_add_ons (tenant_id, add_on_id, price_cents, status) select ${t}, id, 3900, 'active' from plan_add_ons where code = 'marketing_suite'`.execute(db);
      gate.invalidateTenant(t);
      expect(await call('marketing', t)).toBe(true);
      expect((await call('loyalty', t)).getStatus()).toBe(403);   // the add-on grants ITS feature only
      await sql`update tenant_add_ons set status = 'cancelled' where tenant_id = ${t}`.execute(db);
      gate.invalidateTenant(t);
      expect((await call('marketing', t)).getStatus()).toBe(403);
    });
  });
  it('a Super Admin override wins both ways; in the default mode the "disabled" override is only observed', async () => {
    await sql`insert into tenant_feature_overrides (tenant_id, feature_key, state, reason) values (${tenants['starter-with-override']}, 'loyalty', 'enabled', 'pilot'), (${tenants['unlimited-override-off']}, 'loyalty', 'disabled', 'abuse review')`.execute(db);
    await withMode('enforce', async () => {
      expect(await call('loyalty', tenants['starter-with-override'])).toBe(true);
      expect((await call('loyalty', tenants['unlimited-override-off'])).getResponse()).toMatchObject({ code: 'FEATURE_NOT_IN_PLAN', reason: 'OVERRIDE_DISABLED' });
    });
    expect(await withMode(undefined, () => call('loyalty', tenants['unlimited-override-off']))).toBe(true);
  });
  it('a platform stop (a killed rollout flag) blocks in EVERY mode except off — a deliberate Super Admin action', async () => {
    await sql`insert into platform_flag_rollouts (flag_key, killed, reason) values ('smart_reminders', true, 'incident #42 — reminders paused')`.execute(db);
    try {
      expect((await withMode(undefined, () => call('smart_reminders', tenants['plan:unlimited']))).getResponse()).toMatchObject({ reason: 'FLAG_KILLED', upgradeTo: null });
      expect(await withMode('off', () => call('smart_reminders', tenants['plan:unlimited']))).toBe(true);
    } finally { await sql`delete from platform_flag_rollouts where flag_key = 'smart_reminders'`.execute(db); }
  });
});

describe('cache ≤ 60 s, dropped on the write that changes the answer', () => {
  it('an override written through EntitlementsService reaches the very next request in this process', async () => {
    const svc = fresh();
    const ent = invalidateOnWrite(new EntitlementsService(new KyselyEntitlementsRepo(db)), svc, { setFeatureOverride: 0 });
    const t = tenants['plan:starter'];
    await withMode('enforce', async () => {
      expect((await call('communications', t, svc)).getStatus()).toBe(403);   // cached: NOT_IN_PLAN
      await ent.setFeatureOverride(t, { featureKey: 'communications', state: 'enabled', reason: 'goodwill' }, { userId: id(999), role: 'SUPER_ADMIN', permissions: ['super_admin.subscriptions.manage'] } as any);
      expect(await call('communications', t, svc)).toBe(true);                // invalidated → re-read
      await sql`delete from tenant_feature_overrides where tenant_id = ${t} and feature_key = 'communications'`.execute(db);   // a write NOT through the service…
      expect(await call('communications', t, svc)).toBe(true);                // …is seen only after the TTL (≤ 60 s) — the honest bound
      svc.clear();
      expect((await call('communications', t, svc)).getStatus()).toBe(403);
    });
  });
});
