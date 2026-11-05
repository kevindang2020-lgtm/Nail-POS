// display-ads.pgtest.vitest.spec.ts — Customer Display Advertising on the REAL schema (every migration, PGlite), through
// the real service, repository, playlist builder and notifier (23-inch dual-screen spec §47–§78, §108–§111):
//   • TENANT ISOLATION (§62, §119): a salon's ads never reach another salon's display; another salon's ad and image ids
//     are "not found"; the composite keys refuse cross-salon rows even from raw SQL
//   • BRANCH ISOLATION (§61, §63, §120): targeting decides which displays play an ad; a branch manager sees and manages
//     only their branch
//   • the lifecycle (§64): draft → publish → pause → resume → archive → restore → delete; versions; audit rows (§76)
//   • the layers (§111): platform/plan, salon, branch, display; the platform limits (§110): ads, storage, file types
//   • uploads (§68–§71): stored in object storage (never the database), refused uploads leave nothing behind
//   • display counts (§108): hourly roll-ups, a resent batch counts once, other salons' ad ids are dropped
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

const T1 = 'da000000-0000-4000-8000-0000000000a1', T2 = 'da000000-0000-4000-8000-0000000000a2';
const B1 = 'da000000-0000-4000-8000-0000000000b1', B2 = 'da000000-0000-4000-8000-0000000000b2', B3 = 'da000000-0000-4000-8000-0000000000b3';
const D1 = 'da000000-0000-4000-8000-0000000000d1', D2 = 'da000000-0000-4000-8000-0000000000d2', D3 = 'da000000-0000-4000-8000-0000000000d3';
const OWNER = 'da000000-0000-4000-8000-0000000000c1', MGR = 'da000000-0000-4000-8000-0000000000c2', OWNER2 = 'da000000-0000-4000-8000-0000000000c3';
// BUILD_PLAN Phase 9: contexts carry their role's real session permissions (the salon-wide reach is a permission now)
const owner: AdsCtx = { tenantId: T1, branchId: B1, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') };
const manager: AdsCtx = { tenantId: T1, branchId: B1, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') };
const owner2: AdsCtx = { tenantId: T2, branchId: B3, userId: OWNER2, role: 'OWNER', permissions: permissionsFor('OWNER') };

let pg: PGlite; let db: Kysely<any>; let repo: DisplayAdsRepository;
let svc: DisplayAdsService; let playlists: DisplayAdsPlaylistService;
let now = new Date('2026-10-05T15:00:00Z');   // Monday 11:00 in New York
let avail: DisplayAdsAvailability = { active: true, reason: null, detail: null };
const stored = new Map<string, number>();
const emitted: { to: string; id: string; event: string; payload: any }[] = [];
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const err = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as DisplayAdError; } throw new Error('expected a DisplayAdError'); };

const pngBytes = (w: number, h: number) => new Uint8Array(PNG.sync.write(new PNG({ width: w, height: h })));
let IMG: Record<'original' | 'large' | 'medium' | 'thumb', Uint8Array>;
const files = (o: Partial<Record<'original' | 'large' | 'medium' | 'thumb', Uint8Array>> = {}) => {
  const f = { ...IMG, ...o };
  return {
    original: [{ buffer: f.original, mimetype: 'image/png', originalname: 'promo.png' }], large: [{ buffer: f.large, mimetype: 'image/png', originalname: 'large.png' }],
    medium: [{ buffer: f.medium, mimetype: 'image/png', originalname: 'medium.png' }], thumb: [{ buffer: f.thumb, mimetype: 'image/png', originalname: 'thumb.png' }],
  };
};

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    const s = readFileSync(join(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '').replace(/\bINDEX\s+CONCURRENTLY\b/gi, 'INDEX');   // Phase 10: CONCURRENTLY cannot run in PGlite's implicit transaction (same rule as pgliteCompatible)
    try { await pg.exec(s); } catch { /* tolerated — PGlite lacks a few extensions */ }
  }
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (k: any) => new PostgresIntrospector(k), createQueryCompiler: () => new PostgresQueryCompiler() } });
  for (const [t, code] of [[T1, 'DADS1'], [T2, 'DADS2']]) await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, $2, $2, lower($3), $3, 'active')`, [t, `Salon ${code}`, code]);
  for (const [b, t, n] of [[B1, T1, 'Cherry Hill'], [B2, T1, 'Marlton'], [B3, T2, 'Other Salon Main']]) await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active','America/New_York')`, [b, t, n]);
  for (const [d, t, b] of [[D1, T1, B1], [D2, T1, B2], [D3, T2, B3]]) await q(`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) values ($1,$2,$3,$4,'android','paired')`, [d, t, b, `Display ${d.slice(-2)}`]);
  IMG = { original: pngBytes(1080, 1620), large: pngBytes(1080, 1620), medium: pngBytes(720, 1080), thumb: pngBytes(213, 320) };
}, 120_000);

beforeEach(async () => {
  now = new Date('2026-10-05T15:00:00Z');
  avail = { active: true, reason: null, detail: null };
  emitted.length = 0;
  repo = new DisplayAdsRepository(db as any);
  const availability = { resolve: async () => avail };
  const limits = new PlatformLimitsSource(repo, 0);
  const storage = { put: async (k: string, b: Buffer) => { stored.set(k, b.length); return { url: '/media/' + k }; }, remove: async (k: string) => { stored.delete(k); }, resolvePath: () => null };
  const rt: any = {
    toTenant: (c: any, event: string, payload: any) => emitted.push({ to: 'tenant', id: c.branchId, event, payload }),
    toCustomerDisplayDevice: (id: string, event: string, payload: any) => emitted.push({ to: 'device', id, event, payload }),
    toOwner: (tenantId: string, event: string, payload: any) => emitted.push({ to: 'owner', id: tenantId, event, payload }),
  };
  playlists = new DisplayAdsPlaylistService(repo, availability, limits, db, () => now);
  svc = new DisplayAdsService(repo, availability, limits, storage as any, new DisplayAdsNotifier(repo, rt), playlists, () => now);
  await q(`delete from platform_settings where setting_key like 'display_ads.%'`);
  await q(`delete from tenant_settings where category = 'customer-display-ads'`);
  await q(`delete from display_ad_device_settings`);
  await q(`delete from display_ads`);
  await q(`update display_ad_media set deleted_at = now() where deleted_at is null`);
});

const upload = async (ctx = owner, o?: Parameters<typeof files>[0]) => svc.uploadMedia(ctx, files(o), { focalX: '0.4', focalY: '0.3' });
const devicePlaylist = (d: string, t = T1, b = d === D2 ? B2 : B1) => playlists.playlistForDevice({ deviceId: d, tenantId: t, branchId: t === T2 ? B3 : b });

describe('upload (§68–§71)', () => {
  it('stores the original and three copies in object storage — the database holds keys and metadata only', async () => {
    const m = await upload();
    expect(m).toMatchObject({ mimeType: 'image/png', width: 1080, height: 1620, medium: { width: 720, height: 1080 }, thumb: { width: 213, height: 320 }, suggestedFocalX: 0.4, suggestedFocalY: 0.3 });
    const row = (await q(`select storage_key, variants, total_bytes, sha256 from display_ad_media where id = $1 and tenant_id = $2`, [m.id, T1]))[0];
    expect(row.storage_key).toMatch(new RegExp(`^tenants/${T1}/display-ads/${m.id}/original-[0-9a-f]{24}\\.png$`));   // Phase 12 (#34): under the salon
    expect(stored.has(row.storage_key) && stored.has(row.variants.large.key) && stored.has(row.variants.medium.key) && stored.has(row.variants.thumb.key)).toBe(true);
    expect(m.medium.url).toBe(`/media/tenants/${T1}/display-ads/${m.id}/medium.png`);
    expect(JSON.stringify(m)).not.toContain('original-');   // the POS never receives the original's address
    expect(Number(row.total_bytes)).toBe(IMG.original.length + IMG.large.length + IMG.medium.length + IMG.thumb.length);
    const audit = await q(`select action_type, metadata_json from audit_logs where tenant_id = $1 and action_type = 'display_ad_media_uploaded' order by created_at desc limit 1`, [T1]);
    expect(audit[0].metadata_json).toMatchObject({ mediaId: m.id, width: 1080, height: 1620 });
  });
  it('Phase 12 (#34): the public original is stored WITHOUT its text / EXIF metadata (the upload policy strips it)', async () => {
    const { crc32 } = await import('node:zlib');
    const td = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from('GPS\0SECRET-40.7128N', 'latin1')]);
    const n = Buffer.alloc(4); n.writeUInt32BE(td.length - 4); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0);
    const text = Buffer.concat([n, td, c]);
    const plain = Buffer.from(IMG.original);
    const tagged = new Uint8Array(Buffer.concat([plain.subarray(0, 33), text, plain.subarray(33)]));
    const m = await upload(owner, { original: tagged });
    const row = (await q(`select storage_key, total_bytes from display_ad_media where id = $1 and tenant_id = $2`, [m.id, T1]))[0];
    expect(stored.get(row.storage_key)).toBe(plain.length);   // exactly the picture, the metadata chunk gone
    expect(Number(row.total_bytes)).toBe(plain.length + IMG.large.length + IMG.medium.length + IMG.thumb.length);
  });
  it('a refused upload stores nothing', async () => {
    const before = stored.size;
    const html = new Uint8Array(Buffer.from('<!doctype html><script>alert(1)</script>'.padEnd(80, ' ')));
    expect((await err(upload(owner, { original: html }))).details).toMatchObject({ reason: 'UNSUPPORTED_TYPE' });
    expect(stored.size).toBe(before);
  });
  it('§110 storage limit: counted under the salon lock; the bytes of a refused upload are removed again', async () => {
    await upload();
    await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ('display_ads.storage_limit_mb', 'customer_display_ads', '10'::jsonb, 'number')`);
    const used = Number((await q(`select coalesce(sum(total_bytes),0) as b from display_ad_media where tenant_id = $1 and deleted_at is null`, [T1]))[0].b);
    const keysBefore = new Set(stored.keys());
    // fill to just under 10 MB with rows, then one more upload must not fit
    await q(`insert into display_ad_media (tenant_id, mime_type, width, height, byte_size, total_bytes, sha256, storage_key, variants) values ($1,'image/png',1,1,1,$2,repeat('a',64),'x','{}'::jsonb)`, [T1, 10 * 1024 * 1024 - used - 1000]);
    const e = await err(upload());
    expect(e).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    expect(new Set(stored.keys())).toEqual(keysBefore);
  });
  it('§110 file types: a type Super Admin disallowed is refused', async () => {
    await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ('display_ads.allowed_mime_types', 'customer_display_ads', '"image/jpeg"'::jsonb, 'string')`);
    expect((await err(upload())).details).toMatchObject({ reason: 'TYPE_NOT_ALLOWED' });
  });
});

describe('lifecycle, versions and audit (§49–§53, §64, §73–§76)', () => {
  it('simple mode: upload → create (draft) → publish → it plays on every display of the salon, and only there', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Fall pedicure', mediaId: m.id });
    expect(ad).toMatchObject({ status: 'DRAFT', storedStatus: 'draft', version: 1, allBranches: true, showingNow: false, canManage: true });
    expect(emitted).toHaveLength(0);   // a draft plays nowhere — nobody is told
    const pub = await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    expect(pub).toMatchObject({ status: 'ACTIVE', storedStatus: 'published', version: 2, showingNow: true });
    expect(emitted.filter((e) => e.to === 'device').map((e) => e.id).sort()).toEqual([D1, D2]);   // NOT D3 — another salon
    expect(emitted.every((e) => e.event === 'customer_display_ads_updated' && e.payload.adId === ad.id)).toBe(true);
    expect(emitted.filter((e) => e.to === 'tenant').map((e) => e.id).sort()).toEqual([B1, B2]);
    const p1 = await devicePlaylist(D1);
    expect(p1).toMatchObject({ enabled: true, ads: [{ id: ad.id, version: 2, image: { url: m.medium.url, width: 720, height: 1080 }, durationSeconds: 10, fit: 'cover' }] });
    expect((await devicePlaylist(D3, T2)).ads).toEqual([]);
    const audits = (await q(`select action_type, user_id, role, entity_id, metadata_json from audit_logs where tenant_id = $1 and entity_id = $2 order by created_at`, [T1, ad.id]));
    expect(audits.map((a) => a.action_type)).toEqual(['display_ad_created', 'display_ad_published']);
    expect(audits[1]).toMatchObject({ user_id: OWNER, role: 'OWNER', metadata_json: { from: 'draft', to: 'published', targeting: { allBranches: true, branchIds: [] } } });
  });

  it('a stale version is a 409 and writes nothing; pause / resume / archive / restore / delete follow §64', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Gift cards', mediaId: m.id });
    await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    expect(await err(svc.update(owner, ad.id, { expectedVersion: 1, headline: 'Too late' }))).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });
    expect((await q(`select headline from display_ads where tenant_id = $1 and id = $2`, [T1, ad.id]))[0].headline).toBeNull();
    expect(await err(svc.act(owner, ad.id, 'publish', { expectedVersion: 2 }))).toMatchObject({ code: 'CONFLICT' });
    expect((await svc.act(owner, ad.id, 'pause', { expectedVersion: 2 })).status).toBe('PAUSED');
    expect((await devicePlaylist(D1)).ads).toEqual([]);                                    // §74 paused → off the displays
    expect((await svc.act(owner, ad.id, 'publish', { expectedVersion: 3 })).status).toBe('ACTIVE');
    expect(await err(svc.remove(owner, ad.id, '4'))).toMatchObject({ code: 'CONFLICT' });   // a live ad can't be deleted
    expect((await svc.act(owner, ad.id, 'archive', { expectedVersion: 4 })).status).toBe('ARCHIVED');
    expect((await devicePlaylist(D1)).ads).toEqual([]);
    expect(await err(svc.update(owner, ad.id, { expectedVersion: 5, name: 'x' }))).toMatchObject({ code: 'CONFLICT' });
    expect((await svc.act(owner, ad.id, 'restore', { expectedVersion: 5 })).status).toBe('DRAFT');
    await svc.act(owner, ad.id, 'archive', { expectedVersion: 6 });
    const keys = (await q(`select storage_key from display_ad_media where id = $1 and tenant_id = $2`, [m.id, T1]))[0];
    expect(stored.has(keys.storage_key)).toBe(true);
    await svc.remove(owner, ad.id, '7');
    expect(await q(`select 1 from display_ads where id = $1`, [ad.id])).toHaveLength(0);
    expect(stored.has(keys.storage_key)).toBe(false);   // its images went with it
    expect((await q(`select deleted_at from display_ad_media where id = $1 and tenant_id = $2`, [m.id, T1]))[0].deleted_at).not.toBeNull();
    const actions = (await q(`select action_type from audit_logs where tenant_id = $1 and entity_id = $2 order by created_at`, [T1, ad.id])).map((r) => r.action_type);
    expect(actions).toEqual(['display_ad_created', 'display_ad_published', 'display_ad_paused', 'display_ad_published', 'display_ad_archived', 'display_ad_restored', 'display_ad_archived', 'display_ad_deleted']);
  });

  it('§76 a schedule change is its own audit row (before/after); a live ad\'s edit reaches its displays at once', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Weekday special', mediaId: m.id });
    await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    emitted.length = 0;
    const v = await svc.update(owner, ad.id, { expectedVersion: 2, daysOfWeek: [1, 2, 3, 4, 5], dailyStartTime: '10:00', dailyEndTime: '17:00', headline: 'Mon–Fri' });
    expect(v).toMatchObject({ version: 3, daysOfWeek: [1, 2, 3, 4, 5], dailyStartTime: '10:00', showingNow: true });
    expect(emitted.filter((e) => e.to === 'device').length).toBe(2);
    const rows = await q(`select action_type, metadata_json from audit_logs where tenant_id = $1 and entity_id = $2 and action_type in ('display_ad_updated','display_ad_schedule_changed')`, [T1, ad.id]);
    const sch = rows.find((r) => r.action_type === 'display_ad_schedule_changed')!.metadata_json;
    expect(sch).toMatchObject({ before: { daysOfWeek: null, dailyStartTime: null }, after: { daysOfWeek: [1, 2, 3, 4, 5], dailyStartTime: '10:00', dailyEndTime: '17:00' } });
    expect(rows.find((r) => r.action_type === 'display_ad_updated')!.metadata_json.changed.sort()).toEqual(['dailyEndTime', 'dailyStartTime', 'daysOfWeek', 'headline']);
    // §65 the backend decides by the clock: outside its hours it is not played
    now = new Date('2026-10-05T22:00:00Z');   // 18:00 New York
    expect((await devicePlaylist(D1)).ads).toEqual([]);
    now = new Date('2026-10-10T15:00:00Z');   // Saturday
    expect((await devicePlaylist(D1)).ads).toEqual([]);
  });

  it('publishing needs the image, and an ad past its end date cannot be published', async () => {
    const ad = await svc.create(owner, { name: 'No image yet' });
    expect(await err(svc.act(owner, ad.id, 'publish', { expectedVersion: 1 }))).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'mediaId' } });
    const m = await upload();
    await svc.update(owner, ad.id, { expectedVersion: 1, mediaId: m.id, startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(await err(svc.act(owner, ad.id, 'publish', { expectedVersion: 2 }))).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'endDate' } });
  });

  it('§110 the ad limit: counted under the salon lock; archived ads do not count; restoring past the limit is refused', async () => {
    await q(`insert into platform_settings (setting_key, setting_group, value, value_type) values ('display_ads.max_ads_per_tenant', 'customer_display_ads', '2'::jsonb, 'number')`);
    const a = await svc.create(owner, { name: 'A' }); await svc.create(owner, { name: 'B' });
    expect(await err(svc.create(owner, { name: 'C' }))).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { limit: 2 } });
    await svc.act(owner, a.id, 'archive', { expectedVersion: 1 });
    await svc.create(owner, { name: 'C' });
    expect(await err(svc.act(owner, a.id, 'restore', { expectedVersion: 2 }))).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });
});

describe('tenant isolation (§62, §119)', () => {
  it('another salon\'s ad is "not found" — read, edit, publish, delete — and its image cannot be used', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Salon 1 only', mediaId: m.id });
    for (const p of [svc.get(owner2, ad.id), svc.update(owner2, ad.id, { expectedVersion: 1, name: 'pwned' }), svc.act(owner2, ad.id, 'publish', { expectedVersion: 1 }), svc.remove(owner2, ad.id, '1')]) {
      expect((await err(p)).code).toBe('RESOURCE_NOT_FOUND');
    }
    expect(await err(svc.create(owner2, { name: 'Steal image', mediaId: m.id }))).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'mediaId' } });
    expect((await svc.state(owner2)).ads.map((a) => a.id)).not.toContain(ad.id);
    expect((await q(`select name from display_ads where id = $1`, [ad.id]))[0].name).toBe('Salon 1 only');
  });
  it('the SCHEMA refuses cross-salon rows even from raw SQL (composite keys)', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Mine', mediaId: m.id, allBranches: false, branchIds: [B1] });
    await expect(q(`insert into display_ads (tenant_id, name, media_id) values ($1, 'theirs', $2)`, [T2, m.id])).rejects.toThrow(/fk_display_ads_media|foreign key/);
    await expect(q(`insert into display_ad_branches (tenant_id, ad_id, branch_id) values ($1, $2, $3)`, [T1, ad.id, B3])).rejects.toThrow(/fk_display_ad_branches_branch|foreign key/);
    await expect(q(`insert into display_ad_device_settings (tenant_id, device_id) values ($1, $2)`, [T1, D3])).rejects.toThrow(/foreign key/);
  });
  it('a display only ever receives its own salon\'s ads, whatever the other salon publishes', async () => {
    const m1 = await upload(); const m2 = await upload(owner2);
    const a1 = await svc.create(owner, { name: 'S1', mediaId: m1.id }); await svc.act(owner, a1.id, 'publish', { expectedVersion: 1 });
    const a2 = await svc.create(owner2, { name: 'S2', mediaId: m2.id }); await svc.act(owner2, a2.id, 'publish', { expectedVersion: 1 });
    expect((await devicePlaylist(D1)).ads.map((a) => a.id)).toEqual([a1.id]);
    expect((await devicePlaylist(D2)).ads.map((a) => a.id)).toEqual([a1.id]);
    expect((await devicePlaylist(D3, T2)).ads.map((a) => a.id)).toEqual([a2.id]);
    // and at the query itself — not only because the other salon's IMAGE would not resolve (defence in depth, not the rule)
    expect((await repo.publishedAdsForBranch(T1, B1)).map((a) => a.id)).toEqual([a1.id]);
    expect((await repo.publishedAdsForBranch(T2, B3)).map((a) => a.id)).toEqual([a2.id]);
    // even a forged identity pairing salon 2's device with salon 1 gets salon 1's ads only through salon 1's rows —
    // the playlist is keyed by the TRUSTED tenant the device route resolved, never by anything the display sends
    expect(JSON.stringify(await devicePlaylist(D3, T2))).not.toContain(a1.id);
  });
  it('display reports: other salons\' ad ids are dropped; a resent batch counts once; hourly roll-ups', async () => {
    const m1 = await upload(); const m2 = await upload(owner2);
    const a1 = await svc.create(owner, { name: 'S1', mediaId: m1.id });
    const a2 = await svc.create(owner2, { name: 'S2', mediaId: m2.id });
    const body = { batchId: 'batch-000001', displays: [
      { adId: a1.id, shownAt: '2026-10-05T14:10:00Z', durationMs: 10_000 }, { adId: a1.id, shownAt: '2026-10-05T14:50:00Z', durationMs: 9_000 },
      { adId: a1.id, shownAt: '2026-10-05T13:59:00Z', durationMs: 10_000 }, { adId: a2.id, shownAt: '2026-10-05T14:20:00Z', durationMs: 10_000 },
      { adId: a1.id, shownAt: '2026-10-02T14:20:00Z', durationMs: 10_000 }, { adId: a1.id, shownAt: 'nonsense', durationMs: 10_000 },
      { adId: a1.id, shownAt: '2026-10-05T14:55:00Z', durationMs: 9_999_999 },
    ] };
    expect(await playlists.recordDisplays({ deviceId: D1, tenantId: T1, branchId: B1 }, body)).toEqual({ duplicate: false, accepted: 4 });
    expect(await playlists.recordDisplays({ deviceId: D1, tenantId: T1, branchId: B1 }, body)).toEqual({ duplicate: true, accepted: 0 });
    const rows = await q(`select ad_id, hour_start, display_count, display_ms from display_ad_display_stats where tenant_id = $1 order by hour_start`, [T1]);
    expect(rows.map((r) => [new Date(r.hour_start).toISOString(), r.display_count, Number(r.display_ms)])).toEqual([
      ['2026-10-05T13:00:00.000Z', 1, 10_000], ['2026-10-05T14:00:00.000Z', 3, 10_000 + 9_000 + 120_000],
    ]);
    expect(await q(`select 1 from display_ad_display_stats where tenant_id = $1 or ad_id = $2`, [T2, a2.id])).toHaveLength(0);
    const an = await svc.analytics(owner, 30, undefined);
    // D1's last report (14:55) is within 5 minutes of "now" (15:00): it is showing ads now; D2 never reported
    expect(an.totals).toMatchObject({ displayCount: 4, displaySeconds: 149, devicesShowingNow: 1, displaysRegistered: 2 });
    expect(an.byBranch.map((b) => [b.name, b.displayCount, b.devicesShowingNow])).toEqual([['Cherry Hill', 4, 1], ['Marlton', 0, 0]]);
    expect(an.byAd).toEqual([{ adId: a1.id, name: 'S1', displayCount: 4, displaySeconds: 149, lastShownAt: '2026-10-05T14:55:00.000Z' }]);
    expect((await err(playlists.recordDisplays({ deviceId: D1, tenantId: T1, branchId: B1 }, { batchId: 'x', displays: [] }))).code).toBe('VALIDATION_FAILED');
  });
});

describe('branch isolation and the branch manager (§61, §63, §120)', () => {
  it('targeting decides which displays play an ad', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Marlton only', mediaId: m.id, allBranches: false, branchIds: [B2] });
    await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    expect(emitted.filter((e) => e.to === 'device').map((e) => e.id)).toEqual([D2]);
    expect((await devicePlaylist(D1)).ads).toEqual([]);
    expect((await devicePlaylist(D2)).ads.map((a) => a.id)).toEqual([ad.id]);
    // moving it to Cherry Hill tells BOTH branches (the old one must drop it, the new one must pick it up)
    emitted.length = 0;
    await svc.update(owner, ad.id, { expectedVersion: 2, branchIds: [B1] });
    expect(emitted.filter((e) => e.to === 'device').map((e) => e.id).sort()).toEqual([D1, D2]);
    expect((await devicePlaylist(D1)).ads.map((a) => a.id)).toEqual([ad.id]);
    expect((await devicePlaylist(D2)).ads).toEqual([]);
  });
  it('a manager sees what plays at their branch and manages only what plays ONLY there', async () => {
    const m = await upload();
    const all = await svc.create(owner, { name: 'Everywhere', mediaId: m.id });
    const other = await svc.create(owner, { name: 'Marlton', mediaId: m.id, allBranches: false, branchIds: [B2] });
    const mine = await svc.create(manager, { name: 'Cherry Hill special', mediaId: m.id });
    expect(mine).toMatchObject({ allBranches: false, branchIds: [B1], canManage: true });   // defaults to the manager's branch
    const st = await svc.state(manager);
    expect(st.ads.map((a) => a.name).sort()).toEqual(['Cherry Hill special', 'Everywhere']);
    expect(st.ads.find((a) => a.id === all.id)!.canManage).toBe(false);
    expect(st).toMatchObject({ canManageAllBranches: false, authorizedBranchIds: [B1], settings: { canEditTenant: false } });
    expect(Object.keys(st.settings.branches)).toEqual([B1]);
    expect(st.devices.map((d) => d.id)).toEqual([D1]);
    expect((await err(svc.get(manager, other.id))).code).toBe('RESOURCE_NOT_FOUND');
    expect((await err(svc.act(manager, all.id, 'pause', { expectedVersion: 1 }))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await err(svc.create(manager, { name: 'x', allBranches: true }))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await err(svc.create(manager, { name: 'x', allBranches: false, branchIds: [B1, B2] }))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await err(svc.update(manager, mine.id, { expectedVersion: 1, allBranches: true }))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await svc.act(manager, mine.id, 'publish', { expectedVersion: 1 })).status).toBe('ACTIVE');
    expect((await err(svc.saveSettings(manager, null, { enabled: false }))).code).toBe('PERMISSION_DENIED');
    expect((await err(svc.saveSettings(manager, B2, { enabled: false }))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await err(svc.setDevice(manager, D2, { adsEnabled: false }))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await err(svc.playlist(manager, B2))).code).toBe('BRANCH_ACCESS_DENIED');
    expect((await err(svc.analytics(manager, 30, B2))).code).toBe('BRANCH_ACCESS_DENIED');
    await svc.saveSettings(manager, B1, { enabled: false });
    expect((await devicePlaylist(D1)).offReason).toBe('disabled_for_branch');
    expect((await devicePlaylist(D2)).enabled).toBe(true);
  });
});

describe('the layers (§111) and Super Admin availability (§110)', () => {
  it('salon off → every display shows the branded panel; a display can be switched off alone', async () => {
    const t0 = (await q(`select now() as n`))[0].n;
    const m = await upload();
    const ad = await svc.create(owner, { name: 'A', mediaId: m.id }); await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    emitted.length = 0;
    await svc.saveSettings(owner, null, { enabled: false, defaultDurationSeconds: 12 });
    expect(emitted.filter((e) => e.to === 'device').map((e) => e.id).sort()).toEqual([D1, D2]);
    // Constitution 9 §246: a tenant_settings row changed → the owner's screens hear settings_updated
    expect(emitted.filter((e) => e.to === 'owner')).toEqual([{ to: 'owner', id: T1, event: 'settings_updated', payload: { category: 'customer-display-ads' } }]);
    expect(await devicePlaylist(D1)).toMatchObject({ enabled: false, offReason: 'disabled_by_salon', ads: [] });
    await svc.saveSettings(owner, null, { enabled: true });
    expect((await devicePlaylist(D1)).ads[0].durationSeconds).toBe(12);   // the other setting survived the merge
    emitted.length = 0;
    await svc.setDevice(owner, D2, { adsEnabled: false });
    expect(emitted).toEqual([{ to: 'device', id: D2, event: 'customer_display_ads_updated', payload: { reason: 'device' } }]);
    expect((await devicePlaylist(D2)).offReason).toBe('disabled_for_display');
    expect((await devicePlaylist(D1)).enabled).toBe(true);
    expect((await err(svc.setDevice(owner, D3, { adsEnabled: false }))).code).toBe('RESOURCE_NOT_FOUND');   // another salon's display
    const s = await q(`select action_type, metadata_json from audit_logs where tenant_id = $1 and created_at >= $2 and action_type in ('display_ads_settings_updated','display_ads_device_updated') order by created_at`, [T1, t0]);
    expect(s.map((r) => r.action_type)).toEqual(['display_ads_settings_updated', 'display_ads_settings_updated', 'display_ads_device_updated']);
    expect(s[0].metadata_json).toMatchObject({ scope: 'tenant', after: { enabled: false, defaultDurationSeconds: 12 } });
  });
  it('feature not available (platform or plan): displays get the fallback; the POS cannot create or publish — but CAN take ads down', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'A', mediaId: m.id }); await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    avail = { active: false, reason: 'FEATURE_DISABLED', detail: 'Disabled platform-wide.' };
    expect(await devicePlaylist(D1)).toMatchObject({ enabled: false, offReason: 'not_available' });
    expect((await err(svc.create(owner, { name: 'B' }))).code).toBe('FEATURE_UNAVAILABLE');
    expect((await err(upload())).code).toBe('FEATURE_UNAVAILABLE');
    expect((await svc.act(owner, ad.id, 'pause', { expectedVersion: 2 })).status).toBe('PAUSED');
    expect((await err(svc.act(owner, ad.id, 'publish', { expectedVersion: 3 }))).code).toBe('FEATURE_UNAVAILABLE');
  });
  it('the real availability resolver: registry → plan; an unmapped (legacy) plan is not restricted unless switched off for the salon', async () => {
    const reg = (r: any) => ({ resolve: async () => r });
    const ent = (mapped: boolean, features: any[] = []) => ({ getEntitlements: async () => ({ plan: { mapped }, features }) });
    const NOT = { active: false, reason: 'NOT_ENTITLED', detail: 'x' };
    expect((await new DisplayAdsAvailabilityResolver(reg({ active: true }), ent(true)).resolve(T1)).active).toBe(true);
    expect((await new DisplayAdsAvailabilityResolver(reg(NOT), ent(false)).resolve(T1)).active).toBe(true);
    expect((await new DisplayAdsAvailabilityResolver(reg(NOT), ent(false, [{ featureKey: 'customer_display_ads', enabled: false }])).resolve(T1)).active).toBe(false);
    expect((await new DisplayAdsAvailabilityResolver(reg(NOT), ent(true)).resolve(T1))).toMatchObject({ active: false, reason: 'NOT_ENTITLED' });
    expect((await new DisplayAdsAvailabilityResolver(reg({ active: false, reason: 'FEATURE_DISABLED', detail: 'off' }), ent(false)).resolve(T1)).active).toBe(false);
    let calls = 0; let t = 0;
    const flaky = { resolve: async () => { calls++; if (calls > 1) throw new Error('db down'); return { active: true }; } };
    const r = new DisplayAdsAvailabilityResolver(flaky, null, 1000, () => t);
    expect((await r.resolve(T1)).active).toBe(true);
    t = 5000; expect((await r.resolve(T1)).active).toBe(true);    // the check failed: the last known answer stands
    expect((await new DisplayAdsAvailabilityResolver({ resolve: async () => { throw new Error('x'); } }, null).resolve(T1)).active).toBe(false);   // none known: closed
  });
  it('the migration registered the feature for the platform and every catalog plan', async () => {
    expect((await q(`select status, category from platform_features where feature_key = 'customer_display_ads'`))[0]).toEqual({ status: 'AVAILABLE', category: 'marketing' });
    const plans = (await q(`select p.code from plan_features f join subscription_plans p on p.id = f.plan_id where f.feature_key = 'customer_display_ads' and f.state = 'enabled' order by p.code`)).map((r) => r.code);
    expect(plans).toEqual(['enterprise', 'premium', 'professional', 'starter', 'unlimited']);
  });
});

describe('BUILD_PLAN Phase 12 (#27): the display_ad lifecycle machine on every status write', () => {
  const W = { tenantId: T1, branchId: B1, userId: OWNER, role: 'OWNER' };
  it('the repository refuses a move the machine does not list (archived → published), even past the service', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Machine', mediaId: m.id });
    await svc.act(owner, ad.id, 'archive', { expectedVersion: 1 });
    const e: any = await repo.setStatus(W, ad.id, 2, 'archived', 'published', [], 50).catch((x) => x);
    expect(e).toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409, details: { machine: 'display_ad', from: 'archived', to: 'published' } });
    expect((await q(`select status, version from display_ads where id = $1`, [ad.id]))[0]).toMatchObject({ status: 'archived', version: 2 });
  });
  it('a writer that read a stale status loses (the update is conditional on the state read): conflict, nothing written', async () => {
    const m = await upload();
    const ad = await svc.create(owner, { name: 'Race', mediaId: m.id });
    await svc.act(owner, ad.id, 'publish', { expectedVersion: 1 });
    // a second tab still believes the ad is a draft at version 2
    const e: any = await repo.setStatus(W, ad.id, 2, 'draft', 'archived', [], 50).catch((x) => x);
    expect(e?.code).toBe('VERSION_CONFLICT');
    expect((await q(`select status from display_ads where id = $1`, [ad.id]))[0].status).toBe('published');
  });
});
