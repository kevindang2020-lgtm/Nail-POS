// platform-advertising.pgtest — Global Advertising + Tenant Control guide (Nov 5 2026, G7, migration 818) on the REAL
// schema: OFF = AI PowerSalon ads only, ON = each salon's own ads only (never mixed); tenant writes refused while OFF and
// the saved campaigns kept; the switch is versioned, reasoned and audited; fleet status counts only acknowledgments.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { PNG } from 'pngjs';
import type { DisplayAdsAvailability } from '@aipowersalon/api-contracts/tenant';
import { DisplayAdsRepository } from './display-ads.repository';
import { DisplayAdsService, type AdsCtx } from './display-ads.service';
import { DisplayAdsPlaylistService } from './display-ads-playlist.service';
import { DisplayAdsAvailabilityResolver, DisplayAdsNotifier, PlatformLimitsSource } from './display-ads-sources';
import type { DisplayAdError } from './display-ads-core';
import { AdvertisingPolicyStore, PlatformAdvertisingService } from './platform-advertising';
import { permissionsFor } from '@aipowersalon/permissions';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}


const T1 = 'db000000-0000-4000-8000-0000000000a1', T2 = 'db000000-0000-4000-8000-0000000000a2';
const B1 = 'db000000-0000-4000-8000-0000000000b1', B3 = 'db000000-0000-4000-8000-0000000000b3';
const D1 = 'db000000-0000-4000-8000-0000000000d1', D3 = 'db000000-0000-4000-8000-0000000000d3', D9 = 'db000000-0000-4000-8000-0000000000d9', D8 = 'db000000-0000-4000-8000-0000000000d8';
const SA = 'db000000-0000-4000-8000-0000000000e1';
const owner: AdsCtx = { tenantId: T1, branchId: B1, userId: 'db000000-0000-4000-8000-0000000000c1', role: 'OWNER', permissions: permissionsFor('OWNER') };
const owner2: AdsCtx = { tenantId: T2, branchId: B3, userId: 'db000000-0000-4000-8000-0000000000c3', role: 'OWNER', permissions: permissionsFor('OWNER') };
let pg: PGlite; let db: Kysely<any>; let svc: DisplayAdsService; let playlists: DisplayAdsPlaylistService; let platform: PlatformAdvertisingService; let policy: AdvertisingPolicyStore;
const now = new Date('2026-10-05T15:00:00Z');
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as DisplayAdError).code ?? (e as Error).message; } };
const pngBytes = (w: number, h: number) => new Uint8Array(PNG.sync.write(new PNG({ width: w, height: h })));
let IMG: Record<'original' | 'large' | 'medium' | 'thumb', Uint8Array>;
const files = () => ({ original: [{ buffer: IMG.original, mimetype: 'image/png', originalname: 'a.png' }], large: [{ buffer: IMG.large, mimetype: 'image/png', originalname: 'l.png' }],
  medium: [{ buffer: IMG.medium, mimetype: 'image/png', originalname: 'm.png' }], thumb: [{ buffer: IMG.thumb, mimetype: 'image/png', originalname: 't.png' }] });
const devicePlaylist = (d: string, t: string, b: string) => playlists.playlistForDevice({ deviceId: d, tenantId: t, branchId: b });
const sa = { userId: SA };

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (k: any) => new PostgresIntrospector(k), createQueryCompiler: () => new PostgresQueryCompiler() } });
  for (const [t, c] of [[T1, 'PADS1'], [T2, 'PADS2']]) await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, $2, $2, lower($3), $3, 'active')`, [t, `Salon ${c}`, c]);
  for (const [b, t] of [[B1, T1], [B3, T2]]) await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [b, t]);
  for (const [d, t, b] of [[D1, T1, B1], [D3, T2, B3], [D9, T1, B1], [D8, T2, B3]]) await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) values ($1,$2,$3,$4,'android','paired')`, [d, t, b, `Display ${d.slice(-2)}`]);
  IMG = { original: pngBytes(1080, 1620), large: pngBytes(1080, 1620), medium: pngBytes(720, 1080), thumb: pngBytes(213, 320) };
  const repo = new DisplayAdsRepository(db as any);
  const availability = { resolve: async (): Promise<DisplayAdsAvailability> => ({ active: true, reason: null, detail: null }) };
  const limits = new PlatformLimitsSource(repo, 0);
  const storage = { put: async (k: string) => ({ url: '/media/' + k }), remove: async () => undefined, resolvePath: () => null };
  const rt: any = { toTenant: () => undefined, toCustomerDisplayDevice: () => undefined, toOwner: () => undefined };
  policy = new AdvertisingPolicyStore(db as any, 0);
  platform = new PlatformAdvertisingService(db as any, storage as any, limits, policy, async () => undefined, () => now);
  playlists = new DisplayAdsPlaylistService(repo, availability, limits, db, () => now, policy, platform);
  svc = new DisplayAdsService(repo, availability, limits, storage as any, new DisplayAdsNotifier(repo, rt), playlists, () => now, policy);
}, 180_000);

describe('the master switch and exclusive playlists (§07–§10, §82–§83)', () => {
  let a1 = ''; let a2 = '';
  it('ON (the starting state, today\'s behaviour): each salon plays only its own ads; the playlist says TENANT_ONLY v1', async () => {
    const m1 = await svc.uploadMedia(owner, files(), {}); const m2 = await svc.uploadMedia(owner2, files(), {});
    const x1 = await svc.create(owner, { name: 'Salon 1 promo', mediaId: m1.id }); a1 = x1.id; await svc.act(owner, a1, 'publish', { expectedVersion: x1.version });
    const x2 = await svc.create(owner2, { name: 'Salon 2 promo', mediaId: m2.id }); a2 = x2.id; await svc.act(owner2, a2, 'publish', { expectedVersion: x2.version });
    const p1 = await devicePlaylist(D1, T1, B1); const p2 = await devicePlaylist(D3, T2, B3);
    expect(p1).toMatchObject({ mode: 'TENANT_ONLY', policyVersion: 1 }); expect(p1.ads.map((a) => a.id)).toEqual([a1]);
    expect(p2.ads.map((a) => a.id)).toEqual([a2]);
  });
  it('§37: switching OFF with no ready platform ad needs the neutral panel confirmed; a reason and the current version are required', async () => {
    expect(await code(platform.setPolicy(sa, { allowTenantAdvertising: false, reason: 'Platform launch', expectedVersion: 1 }))).toBe('CONFLICT');
    expect(await code(platform.setPolicy(sa, { allowTenantAdvertising: false, reason: 'no', expectedVersion: 1, acceptNeutralFallback: true }))).toBe('VALIDATION_FAILED');
    expect(await code(platform.setPolicy(sa, { allowTenantAdvertising: false, reason: 'Platform launch', expectedVersion: 7, acceptNeutralFallback: true }))).toBe('VERSION_CONFLICT');
  });
  it('§82: four platform pictures, published, then OFF: every display plays exactly those four in order — no salon ad, no mix', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = await platform.uploadMedia(sa, files(), {});
      expect((await q(`select storage_key from platform_ad_media where id = $1`, [m.id]))[0].storage_key).toMatch(/^global\/display-ads\//);
      const ad = await platform.create(sa, { name: `Platform ${i + 1}`, mediaId: m.id, priority: 10 - i, allBranches: false, tenantId: T1 });
      expect((ad as any).tenantId).toBeUndefined();
      ids.push(ad.id); await platform.act(sa, ad.id, 'publish', { expectedVersion: ad.version });
    }
    // publishing never moves the switch (§35)
    expect((await policy.current()).mode).toBe('TENANT_ONLY');
    const pv = await platform.preview();
    expect(pv).toMatchObject({ liveTenantAds: 2, tenantsWithLiveAds: 2, platformAdsReady: 4, registeredDisplays: 4 });
    const out = await platform.setPolicy(sa, { allowTenantAdvertising: false, reason: 'Platform launch week', expectedVersion: 1 });
    expect(out).toMatchObject({ version: 2, changed: true });
    for (const [d, t, b] of [[D1, T1, B1], [D3, T2, B3]]) {
      const p = await devicePlaylist(d, t, b);
      expect(p).toMatchObject({ mode: 'PLATFORM_ONLY', policyVersion: 2, enabled: true });
      expect(p.ads.map((a) => a.id)).toEqual(ids);
    }
    expect((await q(`select to_mode, reason from advertising_policy_events order by created_at desc limit 1`))[0]).toEqual({ to_mode: 'PLATFORM_ONLY', reason: 'Platform launch week' });
    expect(await code(q(`delete from advertising_policy_events`))).toMatch(/append-only|P0001/);
  });
  it('§42 / §76: OFF refuses salon uploads, new ads, edits and publishing at the API — pausing stays possible; nothing is deleted', async () => {
    expect(await code(svc.uploadMedia(owner, files(), {}))).toBe('ADVERTISING_MANAGED_BY_PLATFORM');
    expect(await code(svc.create(owner, { name: 'New' }))).toBe('ADVERTISING_MANAGED_BY_PLATFORM');
    const cur = await svc.get(owner, a1);
    expect(await code(svc.update(owner, a1, { name: 'Renamed', expectedVersion: cur.version }))).toBe('ADVERTISING_MANAGED_BY_PLATFORM');
    const paused = await svc.act(owner, a1, 'pause', { expectedVersion: cur.version });
    expect(await code(svc.act(owner, a1, 'publish', { expectedVersion: paused.version }))).toBe('ADVERTISING_MANAGED_BY_PLATFORM');
    const st = await svc.state(owner);
    expect(st.advertisingPolicy).toEqual({ mode: 'PLATFORM_ONLY', version: 2, managedByPlatform: true });
    expect(st.ads.map((a) => a.id)).toContain(a1);   // kept
  });
  it('§45: ON again → each salon\'s still-published ads only (the one it paused stays paused); no platform ad leaks in', async () => {
    await platform.setPolicy(sa, { allowTenantAdvertising: true, reason: 'Pilot finished', expectedVersion: 2 });
    expect((await devicePlaylist(D1, T1, B1)).ads).toEqual([]);   // salon 1 paused its only ad — the neutral salon panel, not platform ads
    expect((await devicePlaylist(D3, T2, B3)).ads.map((a) => a.id)).toEqual([a2]);
  });
  it('§63–§65 / §86: fleet status counts acknowledgments only; registered = applied + pending + offline; revoked excluded', async () => {
    const v = (await policy.current()).version;   // 3, TENANT_ONLY
    await q(`update customer_display_devices set last_seen_at = $2, applied_ad_policy_version = $3, applied_ad_mode = 'TENANT_ONLY' where id = $1`, [D1, now, v]);     // applied
    await q(`update customer_display_devices set last_seen_at = $2, applied_ad_policy_version = 2, applied_ad_mode = 'PLATFORM_ONLY' where id = $1`, [D3, now]);  // online, stale ACK → pending
    await q(`update customer_display_devices set last_seen_at = $2, applied_ad_policy_version = $3, applied_ad_mode = 'TENANT_ONLY' where id = $1`, [D9, new Date(now.getTime() - 600_000), v]);  // offline even with a matching ACK
    await q(`update customer_display_devices set revoked_at = now() where id = $1`, [D8]);
    const f = await platform.fleet();
    expect(f.counts).toEqual({ applied: 1, pending: 1, offline: 1, revoked: 1, connected: 2, registered: 3 });
    expect((await platform.fleet({ status: 'pending' })).items.map((d: any) => d.deviceId)).toEqual([D3]);
  });
});
