// display-ads.postgres-race.vitest.spec.ts — Customer Display Advertising under REAL concurrency (23-inch dual-screen
// spec §64, §73, §108, §110). PGlite is one session and cannot show a race; these race real connections against real
// PostgreSQL with deterministic gates (hold a table lock, let every caller pile up, release):
//   • two managers save the same ad at once → one wins, the other gets VERSION_CONFLICT (never a silent overwrite)
//   • five creates race for the last ad slot → exactly one fits the Super Admin ad limit
//   • three uploads race for the last of the storage limit → the limit holds
//   • a display resends the same report batch three times at once → counted once
// Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { DisplayAdsRepository } from './display-ads.repository';
import { BLANK_AD_FIELDS, applyAdInput } from './display-ads-core';
import { permissionsFor } from '@aipowersalon/permissions';

const url = process.env.PG_RACE_URL;
const T = 'a5d00000-0000-4000-8000-0000000000aa', B = 'b5d00000-0000-4000-8000-0000000000bb', DEV = 'd5d00000-0000-4000-8000-0000000000dd';
const actor = { tenantId: T, branchId: B, userId: 'e5d00000-0000-4000-8000-0000000000ee', role: 'OWNER', permissions: permissionsFor('OWNER') };   // Phase 9: the session's real permissions
let db: Kysely<any>; let pool: pg.Pool; let repo: DisplayAdsRepository;

async function raceWithGate<R>(table: string, runs: (() => Promise<R>)[]) {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query(`lock table ${table} in share mode`);
  const pending = Promise.allSettled(runs.map((f) => f()));
  await new Promise((r) => setTimeout(r, 400));
  await gate.query('commit'); gate.release();
  return pending;
}
const codeOf = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as any)?.code : 'ok');

describe.skipIf(!url)('real-Postgres customer display advertising', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 10 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new DisplayAdsRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Ads Race', 'Ads Race', 'ads-race', 'ADSRACE', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customer_display_devices (id, tenant_id, branch_id, device_name, device_type, pairing_status) values (${DEV}, ${T}, ${B}, 'Race display', 'android', 'paired') on conflict (id) do nothing`.execute(db);
  });
  beforeEach(async () => {
    await sql`delete from display_ads where tenant_id = ${T}`.execute(db);
    await sql`delete from display_ad_report_batches where tenant_id = ${T}`.execute(db);
    await sql`update display_ad_media set deleted_at = now() where tenant_id = ${T} and deleted_at is null`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from display_ads where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('two saves of the same version at the same instant → one wins, the other is a VERSION_CONFLICT', async () => {
    const ad = await repo.createAd(actor, applyAdInput(BLANK_AD_FIELDS, { name: 'Original' }, { requireName: true }), 50, () => []);
    const results = await raceWithGate('display_ads', ['Edit by A', 'Edit by B'].map((name) => () =>
      repo.updateAd(actor, ad.id, 1, applyAdInput(ad, { name }), [{ action: 'display_ad_updated', adId: ad.id, metadata: { name } }])));
    expect(results.map(codeOf).sort()).toEqual(['VERSION_CONFLICT', 'ok']);
    const row = (await sql<any>`select name, version from display_ads where tenant_id = ${T} and id = ${ad.id}`.execute(db)).rows[0];
    const winner = (results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    expect(row).toEqual({ name: winner.name, version: 2 });
    // the loser wrote nothing — not even its audit row
    const audits = (await sql<any>`select metadata_json from audit_logs where tenant_id = ${T} and entity_id = ${ad.id} and action_type = 'display_ad_updated'`.execute(db)).rows;
    expect(audits.map((a) => a.metadata_json.name)).toEqual([winner.name]);
  });

  it('five creates race for the last slot of the ad limit → exactly one gets it', async () => {
    for (const n of ['one', 'two']) await repo.createAd(actor, applyAdInput(BLANK_AD_FIELDS, { name: n }, { requireName: true }), 3, () => []);
    const results = await raceWithGate('display_ads', [1, 2, 3, 4, 5].map((i) => () =>
      repo.createAd(actor, applyAdInput(BLANK_AD_FIELDS, { name: `race ${i}` }, { requireName: true }), 3, () => [])));
    expect(results.map(codeOf).sort()).toEqual(['PLAN_LIMIT_REACHED', 'PLAN_LIMIT_REACHED', 'PLAN_LIMIT_REACHED', 'PLAN_LIMIT_REACHED', 'ok']);
    expect(Number((await sql<any>`select count(*) as n from display_ads where tenant_id = ${T} and status <> 'archived'`.execute(db)).rows[0].n)).toBe(3);
  });

  it('three uploads race for the last of the storage limit → the limit holds', async () => {
    const MB = 1024 * 1024;
    const media = (i: number) => ({
      id: `f5d00000-0000-4000-8000-00000000000${i}`, mimeType: 'image/png', width: 1080, height: 1620, bytes: 1000, totalBytes: 4 * MB,
      sha256: 'a'.repeat(64), storageKey: `display-ads/race-${i}/original.png`, focalX: 0.5, focalY: 0.5, filename: null,
      variants: { large: { key: 'l', url: '/l', width: 1, height: 1, bytes: 1, mime: 'image/png' }, medium: { key: 'm', url: '/m', width: 1, height: 1, bytes: 1, mime: 'image/png' }, thumb: { key: 't', url: '/t', width: 1, height: 1, bytes: 1, mime: 'image/png' } },
    });
    await sql`delete from display_ad_media where tenant_id = ${T}`.execute(db);
    const results = await raceWithGate('display_ad_media', [1, 2, 3].map((i) => () =>
      repo.insertMedia(actor, media(i), 10 * MB, { action: 'display_ad_media_uploaded', adId: null, metadata: {} })));
    expect(results.map(codeOf).sort()).toEqual(['PLAN_LIMIT_REACHED', 'ok', 'ok']);   // 4 + 4 fit in 10 MB, a third does not
    expect(Number((await sql<any>`select sum(total_bytes) as b from display_ad_media where tenant_id = ${T} and deleted_at is null`.execute(db)).rows[0].b)).toBe(8 * MB);
  });

  it('the same report batch sent three times at once is counted once', async () => {
    const ad = await repo.createAd(actor, applyAdInput(BLANK_AD_FIELDS, { name: 'Counted' }, { requireName: true }), 50, () => []);
    const roll = [{ adId: ad.id, hourStart: '2026-10-05T14:00:00.000Z', count: 3, ms: 30_000, first: '2026-10-05T14:01:00.000Z', last: '2026-10-05T14:03:00.000Z' }];
    const results = await raceWithGate('display_ad_report_batches', [1, 2, 3].map(() => () => repo.recordDisplays(T, B, DEV, 'race-batch-0001', roll)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results.map((r) => (r as PromiseFulfilledResult<any>).value.duplicate).sort()).toEqual([false, true, true]);
    const row = (await sql<any>`select display_count, display_ms from display_ad_display_stats where tenant_id = ${T} and ad_id = ${ad.id}`.execute(db)).rows;
    expect(row).toEqual([{ display_count: 3, display_ms: '30000' }]);
  });
});
