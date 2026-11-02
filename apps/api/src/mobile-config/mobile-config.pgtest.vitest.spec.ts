// BUILD_PLAN Phase 13 B (Constitution 6 §52–57, §150, §219–220) on the real schema (migration 558): the Super Admin version
// policy write path, the UPDATE_REQUIRED gate's hard rules end to end through the Nest middleware, the install
// distribution, and GET /app-config (update state, flags through the Phase 11 rollout service, module notices, break-glass).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AuditService, KyselyAuditRepository } from '@aipowersalon/audit';
import { PlatformFlagService, FlagRolloutService } from '../common/platform-flags';
import { MobileVersionsService } from './mobile-versions.service';
import { AppConfigService } from './app-config.service';
import { AppConfigController } from './app-config.controller';
import { UpdateRequiredMiddleware } from './update-required.middleware';

const U = '83838383-8383-4838-8838-838383838383';
const T1 = '00000000-0000-4000-8000-000000000001';
const STORE = 'https://apps.apple.com/app/id1234567890';
let db: any; let versions: MobileVersionsService; let flags: PlatformFlagService; let rollouts: FlagRolloutService; let config: AppConfigService;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  versions = new MobileVersionsService(db, new AuditService(new KyselyAuditRepository(db)));
  flags = new PlatformFlagService(db);
  rollouts = new FlagRolloutService(db, flags, new AuditService(new KyselyAuditRepository(db)));
  config = new AppConfigService(versions, flags, undefined, db);
});

/** Run the middleware like Express would; returns the status it answered with, or 'next'. */
async function through(headers: Record<string, string>, path = '/api/v1/tech/queue', method = 'GET'): Promise<{ status: number | 'next'; body?: any }> {
  const mw = new UpdateRequiredMiddleware(versions);
  let out: { status: number | 'next'; body?: any } = { status: 'next' };
  const res: any = { statusCode: 200, status(n: number) { this.statusCode = n; return this; }, setHeader() { return this; }, json(b: any) { out = { status: this.statusCode, body: b }; return this; } };
  await mw.use({ headers, originalUrl: path, method }, res, () => { out = { status: 'next' }; });
  return out;
}
const native = (v: string, platform = 'ios', app = 'tech') => ({ 'x-client-type': app, 'x-client-version': v, 'x-client-platform': platform, 'x-device-id': `device-${app}-${platform}-${v}-0001` });

describe('Super Admin version policy (§55, §150)', () => {
  it('reason, valid versions and a store link are required; optimistic version; audited', async () => {
    await expect(versions.set('tech', 'ios', { minSupported: '1.5.0', storeUrl: STORE, reason: 'short' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    await expect(versions.set('tech', 'ios', { minSupported: 'one', storeUrl: STORE, reason: 'security fix in 1.5.0' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    await expect(versions.set('tech', 'web', { reason: 'web is never version gated' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    await expect(versions.set('tech', 'ios', { minSupported: '1.5.0', reason: 'no store link given here' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    const v1 = await versions.set('tech', 'ios', { minSupported: '1.5.0', recommended: '1.6.0', latest: '1.7.0', storeUrl: STORE, reason: 'security fix in 1.5.0' }, { userId: U });
    expect(v1).toMatchObject({ app: 'tech', platform: 'ios', minSupported: '1.5.0', recommended: '1.6.0', latest: '1.7.0', storeUrl: STORE, version: 1, updatedBy: U });
    await expect(versions.set('tech', 'ios', { minSupported: '1.5.0', storeUrl: STORE, expectedVersion: 7, reason: 'a stale editor must lose' }, { userId: U })).rejects.toMatchObject({ status: 409 });
    const audits = (await sql<any>`select action_type, entity_id, metadata_json from audit_logs where action_type like 'mobile_versions.%'`.execute(db)).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action_type: 'mobile_versions.minimum_version_changed', entity_id: 'tech/ios' });
    expect(audits[0].metadata_json.reason).toBe('security fix in 1.5.0');
  });
});

describe('the UPDATE_REQUIRED gate (hard rules, end to end)', () => {
  beforeEach(() => versions.clear());
  it('a native build below the minimum gets 426 with the store link; at or above passes', async () => {
    const r = await through(native('1.4.9'));
    expect(r).toMatchObject({ status: 426, body: { code: 'UPDATE_REQUIRED', storeUrl: STORE, minimumVersion: '1.5.0', app: 'tech', platform: 'ios', currentVersion: '1.4.9' } });
    expect((await through(native('1.5.0'))).status).toBe('next');
  });
  it('web apps, the display, the kiosk and header-less requests are never refused', async () => {
    expect((await through({ ...native('0.0.1'), 'x-client-platform': 'web' })).status).toBe('next');
    expect((await through({})).status).toBe('next');
    expect((await through({ 'x-client-type': 'customer-display', 'x-client-version': '0.0.1', 'x-client-platform': 'android' })).status).toBe('next');
    expect((await through({ 'x-client-type': 'kiosk', 'x-client-version': '0.0.1', 'x-client-platform': 'ios' })).status).toBe('next');
  });
  it('a store app / platform with no row is never refused', async () => {
    expect((await through(native('0.0.1', 'android'))).status).toBe('next');
    expect((await through(native('0.0.1', 'ios', 'owner'))).status).toBe('next');
  });
  it('sign-in, refresh, health, /app-config and webhooks stay open for the outdated build', async () => {
    for (const [p, m] of [['/api/v1/auth/login', 'POST'], ['/auth/refresh', 'POST'], ['/health', 'GET'], ['/api/v1/app-config', 'GET'], ['/webhooks/payments/processor', 'POST']] as const)
      expect((await through(native('1.0.0'), p, m)).status, p).toBe('next');
  });
  it('a policy read that starts failing keeps the last good rows (it neither throws nor drops the minimum)', async () => {
    let fail = false; let t = 0;
    const flaky: any = { getExecutor: () => { const ex = db.getExecutor(); return fail ? new Proxy(ex, { get: (o, k) => (k === 'executeQuery' ? () => Promise.reject(new Error('db down')) : (o as any)[k]?.bind?.(o) ?? (o as any)[k]) }) : ex; } };
    const s = new MobileVersionsService(flaky, undefined, () => t);
    expect((await s.policies()).find((r) => r.app === 'tech')?.minSupported).toBe('1.5.0');
    fail = true; t += 31_000;
    await expect(s.policies()).resolves.toHaveLength(1);
    expect(s.lookup('tech', 'ios')?.minSupported).toBe('1.5.0');
  });
  it('a database failure keeps the last good snapshot and never starts refusing', async () => {
    const broken: any = { noteSeen() {}, lookup() { return null; }, policies: async () => { throw new Error('db down'); } };   // anything inside throws
    const mw = new UpdateRequiredMiddleware(broken);
    let nexted = false;
    await mw.use({ headers: native('0.0.1'), originalUrl: '/tech/queue', method: 'GET' }, { status() { throw new Error('should not answer'); } }, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});

describe('install distribution (§150)', () => {
  it('installs are counted once per hashed device id, by version, with their state; raw ids are never stored', async () => {
    await sql`delete from mobile_app_installs_seen`.execute(db);
    const s = new MobileVersionsService(db);
    s.noteSeen('tech', 'ios', '1.4.0', 'device-aaaa-0001');
    s.noteSeen('tech', 'ios', '1.4.0', 'device-aaaa-0001');   // throttled: same install, same version
    s.noteSeen('tech', 'ios', '1.6.0', 'device-bbbb-0002');
    s.noteSeen('tech', 'web', '1.4.0', 'device-cccc-0003');
    s.noteSeen('tech', 'ios', '1.4.0', 'short');                // not a device id
    s.noteSeen('tech', 'ios', 'garbage', 'device-dddd-0004');   // not a version
    await new Promise((r) => setTimeout(r, 50));
    const rows = (await sql<any>`select * from mobile_app_installs_seen`.execute(db)).rows;
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => /^[0-9a-f]{64}$/.test(r.device_hash) && !String(r.device_hash).includes('device'))).toBe(true);
    const o = await versions.overview();
    expect(o.windowDays).toBe(7);
    expect(o.distribution).toEqual(expect.arrayContaining([
      { app: 'tech', platform: 'ios', version: '1.4.0', installs: 1, state: 'UPDATE_REQUIRED' },
      { app: 'tech', platform: 'ios', version: '1.6.0', installs: 1, state: 'SUPPORTED' },
      { app: 'tech', platform: 'web', version: '1.4.0', installs: 1, state: 'SUPPORTED' },
    ]));
    expect(o.totals).toEqual({ installs: 3, unsupported: 1, recommendedUpdate: 0 });
    await sql`update mobile_app_installs_seen set last_seen_at = now() - interval '8 days' where app_version = '1.6.0'`.execute(db);
    expect((await versions.overview()).totals.installs).toBe(2);   // outside the 7-day window
  });
});

describe('GET /app-config (§52–54, §219–220)', () => {
  beforeEach(() => { versions.clear(); flags.clear(); });
  it('tells an outdated build it must update, with the store link — and a current one it is supported', async () => {
    const old = await config.build('tech', 'ios', '1.4.0', null);
    expect(old.update).toMatchObject({ state: 'UPDATE_REQUIRED', minimumVersion: '1.5.0', recommendedVersion: '1.6.0', latestVersion: '1.7.0', storeUrl: STORE });
    expect((await config.build('tech', 'ios', '1.5.1', null)).update.state).toBe('UPDATE_RECOMMENDED');
    expect((await config.build('tech', 'ios', '1.7.0', null)).update.state).toBe('SUPPORTED');
    expect((await config.build('tech', 'web', '0.0.1', null)).update.state).toBe('SUPPORTED');   // web never gated
  });
  it('flags come from the catalogue for that app, through the rollout service, tenant-aware', async () => {
    expect((await config.build('customer', 'ios', '1.0.0', null)).flags).toEqual({ update_prompts: true, maintenance_banner: true, deals: true });
    expect(Object.keys((await config.build('tech', 'ios', '1.7.0', null)).flags)).not.toContain('deals');
    await rollouts.set('mobile.customer.deals', { rolloutPercent: 0, allowTenantIds: [T1], reason: 'deals tab for one pilot salon' }, { userId: U });
    flags.clear();
    expect((await config.build('customer', 'ios', '1.0.0', T1)).flags.deals).toBe(true);
    expect((await config.build('customer', 'ios', '1.0.0', null)).flags.deals).toBe(false);
    await rollouts.set('mobile.customer.deals', { rolloutPercent: 100, killed: true, reason: 'kill the deals tab right now' }, { userId: U });
    flags.clear();
    expect((await config.build('customer', 'ios', '1.0.0', T1)).flags.deals).toBe(false);
  });
  it('a kill switch becomes a module notice; the rest of the app is untouched', async () => {
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values ('ai.auto_actions_disabled', 'kill_switches', 'true'::jsonb, 'boolean')
              on conflict (setting_key) do update set value = excluded.value`.execute(db);
    const c = await new AppConfigService(versions, flags, undefined, db).build('owner', 'android', '1.0.0', null);
    expect(c.modules).toEqual([{ module: 'ai', available: false, message: expect.stringMatching(/AI automation is temporarily unavailable/) }]);
    expect(c.update.state).toBe('SUPPORTED');
  });
  it('any card processor kill switch becomes ONE payments notice', async () => {
    await sql`insert into platform_settings (setting_key, setting_group, value, value_type) values ('payments.clover_disabled', 'kill_switches', 'true'::jsonb, 'boolean')
              on conflict (setting_key) do update set value = excluded.value`.execute(db);
    const c = await new AppConfigService(versions, flags, undefined, db).build('manager-pay', 'ios', '1.0.0', null);
    expect(c.modules.filter((m) => m.module === 'payments')).toEqual([{ module: 'payments', available: false, message: 'Card payments may be temporarily unavailable.' }]);
  });
  it('break-glass is reported', async () => {
    process.env.MAINTENANCE_BREAK_GLASS = 'read_only';
    try { expect((await config.build('owner', 'ios', '1.0.0', null)).breakGlass.mode).toBe('read_only'); }
    finally { delete process.env.MAINTENANCE_BREAK_GLASS; }
  });
  it('the controller validates app / platform, reads the headers as a fallback, and rate-limits', async () => {
    const ctl = new AppConfigController(config);
    await expect(ctl.get({ headers: {} }, 'pos')).rejects.toMatchObject({ status: 400 });
    await expect(ctl.get({ headers: {} }, 'tech', 'blackberry')).rejects.toMatchObject({ status: 400 });
    const viaHeaders = await ctl.get({ headers: native('1.4.0') });
    expect(viaHeaders).toMatchObject({ app: 'tech', platform: 'ios', version: '1.4.0', update: { state: 'UPDATE_REQUIRED' } });
    const req = { headers: {}, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' } };
    let limited = 0;
    for (let i = 0; i < 70; i++) await ctl.get(req, 'tech', 'web').catch((e: any) => { if (e.status === 429) limited++; });
    expect(limited).toBeGreaterThan(0);
  });
});
