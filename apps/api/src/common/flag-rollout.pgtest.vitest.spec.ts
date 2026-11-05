// BUILD_PLAN Phase 11 (Constitution 4 §76) on the real schema: percentage / selected-tenant rollout and the per-flag kill,
// through both readers (the feature registry and PlatformFlagService) and the Super Admin write path (reason, version,
// audit).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { FeatureRegistry } from '@aipowersalon/platform';
import { AuditService, KyselyAuditRepository } from '@aipowersalon/audit';
import { rolloutBucket } from '@aipowersalon/config';
import { PlatformFlagService, FlagRolloutService } from './platform-flags';

const U = '83838383-8383-4838-8838-838383838383';
const tid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ent: any = { getEntitlements: async () => ({ features: [{ featureKey: 'deals_engine', enabled: true, planState: 'enabled', source: 'plan' }] }) };
let db: any; let flags: PlatformFlagService; let svc: FlagRolloutService;
beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  flags = new PlatformFlagService(db);
  svc = new FlagRolloutService(db, flags, new AuditService(new KyselyAuditRepository(db)));
});

describe('flag rollout (§76)', () => {
  it('Super Admin write: reason required, percent validated, optimistic version, audited', async () => {
    await expect(svc.set('deals_engine', { rolloutPercent: 10, reason: 'short' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    await expect(svc.set('deals_engine', { rolloutPercent: 150, reason: 'canary to ten percent' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    const v1 = await svc.set('deals_engine', { rolloutPercent: 0, allowTenantIds: [tid(1)], reason: 'canary: one pilot salon first' }, { userId: U });
    expect(v1).toMatchObject({ flagKey: 'deals_engine', rolloutPercent: 0, allowTenantIds: [tid(1)], version: 1, updatedBy: U });
    await expect(svc.set('deals_engine', { rolloutPercent: 5, expectedVersion: 7, reason: 'stale editor should lose' }, { userId: U })).rejects.toMatchObject({ status: 409 });
    const audits = (await sql<any>`select action_type, entity_id, metadata_json from audit_logs where action_type like 'feature_flags.%'`.execute(db)).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action_type: 'feature_flags.flag_rollout_changed', entity_id: 'deals_engine' });
    expect(audits[0].metadata_json.reason).toBe('canary: one pilot salon first');
  });

  it('the feature registry honours allow list, percentage, deny list and kill — before the plan', async () => {
    const reg = new FeatureRegistry(db, ent);
    expect(await reg.resolve(tid(1), 'deals_engine')).toMatchObject({ active: true });                       // allow list
    expect(await reg.resolve(tid(2), 'deals_engine')).toMatchObject({ active: false, reason: 'NOT_IN_ROLLOUT' }); // 0 %
    // 50 %: exactly the tenants whose bucket is < 50 get it
    await svc.set('deals_engine', { rolloutPercent: 50, deny: [], reason: 'widen to half the fleet', expectedVersion: 1 }, { userId: U });
    for (let i = 2; i < 12; i++) {
      const r = await reg.resolve(tid(i), 'deals_engine');
      expect(r.active).toBe(rolloutBucket('deals_engine', tid(i)) < 50);
    }
    await svc.set('deals_engine', { rolloutPercent: 100, denyTenantIds: [tid(3)], reason: 'everyone but the salon with the bug' }, { userId: U });
    expect(await reg.resolve(tid(3), 'deals_engine')).toMatchObject({ active: false, reason: 'NOT_IN_ROLLOUT' });
    expect(await reg.resolve(tid(4), 'deals_engine')).toMatchObject({ active: true });
    await svc.set('deals_engine', { rolloutPercent: 100, killed: true, reason: 'kill: bad release in the field' }, { userId: U });
    expect(await reg.resolve(tid(1), 'deals_engine')).toMatchObject({ active: false, reason: 'FLAG_KILLED' });
    expect((await sql<any>`select count(*)::int n from audit_logs where action_type = 'feature_flags.flag_killed'`.execute(db)).rows[0].n).toBe(1);
  });

  it('PlatformFlagService.isEnabledFor = the boolean AND the rollout; no policy keeps the old behaviour', async () => {
    expect(await flags.isEnabledFor('some.unset_flag', tid(1), true)).toBe(true);
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values ('rate_limit.tenant_api_enabled', 'global_defaults', 'true'::jsonb, 'boolean')`.execute(db);
    await svc.set('rate_limit.tenant_api_enabled', { rolloutPercent: 0, allowTenantIds: [tid(7)], reason: 'limiter on for one salon first' }, { userId: U });
    expect(await flags.isEnabledFor('rate_limit.tenant_api_enabled', tid(7), false)).toBe(true);
    expect(await flags.isEnabledFor('rate_limit.tenant_api_enabled', tid(8), false)).toBe(false);
    expect(await flags.isEnabled('rate_limit.tenant_api_enabled', false)).toBe(true);   // the plain boolean is unchanged
    expect((await svc.evaluate('rate_limit.tenant_api_enabled', tid(8)))).toMatchObject({ on: false, reason: 'NOT_IN_ROLLOUT' });
  });
});
