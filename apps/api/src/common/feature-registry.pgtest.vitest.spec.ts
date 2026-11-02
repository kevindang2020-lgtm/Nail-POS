// Constitution 7 §30–§33 on the real schema — the feature registry and the layered resolver with structured reasons.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { FeatureRegistry } from '@aipowersalon/platform';

const T = '82828282-8282-4828-8828-828282828282', U = '83838383-8383-4838-8838-838383838383';
let db: any;
// entitlement layer stand-in: the tenant's plan enables deals_engine and advanced_reports only
const ent: any = { getEntitlements: async () => ({ features: [{ featureKey: 'deals_engine', enabled: true, planState: 'enabled', source: 'plan' }, { featureKey: 'advanced_reports', enabled: false, planState: 'unavailable', source: 'plan' }] }) };
beforeAll(async () => { const pg = await migratedPglite(); db = kyselyFor(pg); });

describe('feature registry (§30–§33)', () => {
  it('seeds the §30 features with metadata; kill-switch-capable ones name their switch', async () => {
    const list = await new FeatureRegistry(db).list();
    expect(list.map((f: any) => f.feature_key)).toContain('deals_engine');
    expect(list.length).toBeGreaterThanOrEqual(14);
    expect(list.find((f: any) => f.feature_key === 'deals_engine')).toMatchObject({ status: 'AVAILABLE', platform_kill_switch_supported: true, kill_switch_key: 'deals.engine' });
  });
  it('resolves layer by layer with a structured reason', async () => {
    const reg = new FeatureRegistry(db, ent);
    expect(await reg.resolve(T, 'deals_engine')).toMatchObject({ active: true, source: 'plan' });
    expect(await reg.resolve(T, 'advanced_reports')).toMatchObject({ active: false, reason: 'NOT_ENTITLED' });
    expect(await reg.resolve(T, 'teleportation')).toMatchObject({ active: false, reason: 'FEATURE_UNKNOWN' });
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values ('deals.engine_disabled', 'kill_switches', 'true'::jsonb, 'boolean')`.execute(db);
    expect(await reg.resolve(T, 'deals_engine')).toMatchObject({ active: false, reason: 'KILL_SWITCH_ACTIVE' });        // platform layer beats the plan
    await sql`update platform_settings set value = 'false'::jsonb where setting_key = 'deals.engine_disabled'`.execute(db);
  });
  it('status changes need plans.manage and a reason; EMERGENCY_DISABLED is refused here (kill-switch centre); DISABLED wins over the plan', async () => {
    const reg = new FeatureRegistry(db, ent); const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
    await expect(reg.setStatus('deals_engine', 'DISABLED', 'retiring for redesign', { userId: U, permissions: platformPermissionsFor('PLATFORM_SUPPORT') as string[] })).rejects.toBeTruthy();
    await expect(reg.setStatus('deals_engine', 'EMERGENCY_DISABLED', 'use the kill switch instead', { userId: U, permissions: all })).rejects.toBeTruthy();
    await expect(reg.setStatus('deals_engine', 'DISABLED', 'x', { userId: U, permissions: all })).rejects.toBeTruthy();
    expect(await reg.setStatus('deals_engine', 'DISABLED', 'retiring for redesign', { userId: U, permissions: all })).toMatchObject({ from: 'AVAILABLE', to: 'DISABLED' });
    expect(await reg.resolve(T, 'deals_engine')).toMatchObject({ active: false, reason: 'FEATURE_DISABLED' });
    expect((await sql<any>`select count(*)::int n from audit_logs where action_type = 'platform_feature_status_changed'`.execute(db)).rows[0].n).toBe(1);
  });
});
