// platform-infrastructure.pgtest — the System Status screen's Storage and Deployments panels read real catalog numbers
// on the real schema (Oct 21 2026): the database's size, its heaviest tables, the migration ledger newest-first; media
// settings are reported as names only (a bucket, a region, an endpoint's HOST) — never a credential someone put in a
// URL; without a database every reading says so instead of showing a number.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PlatformInfrastructureService } from './platform-infrastructure';

let db: any;
beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`create table if not exists schema_migrations (filename text primary key, applied_at timestamptz not null default now(), checksum text)`.execute(db);
  await sql`insert into schema_migrations (filename, applied_at) values ('001_init.sql', '2026-01-01T00:00:00Z'), ('671_rollout_flags_tap_to_pay_payroll.sql', '2026-10-21T00:00:00Z') on conflict do nothing`.execute(db);
}, 120_000);

describe('storage', () => {
  it('reports the database size and its heaviest tables from pg_catalog', async () => {
    const r = await new PlatformInfrastructureService(db, { MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'salon-media', MEDIA_S3_REGION: 'us-east-1', MEDIA_S3_ENDPOINT: 'https://AKIA:secret@s3.example.com/x?sig=1', NODE_ENV: 'production' } as any).storage();
    expect(r.database.available).toBe(true);
    expect(r.database.sizeBytes).toBeGreaterThan(0);
    expect(r.database.tables.length).toBeGreaterThan(0);
    expect(r.database.tables.every((t) => typeof t.table === 'string' && t.totalBytes >= 0)).toBe(true);
    expect(r.media).toMatchObject({ store: 'object_storage', bucket: 'salon-media', region: 'us-east-1', endpoint: 's3.example.com', productionSafe: true, envSegment: 'production' });
    expect(JSON.stringify(r)).not.toContain('secret');
  });
  it('on the container disk without the owner\'s acceptance the reading says production is NOT safe', async () => {
    const r = await new PlatformInfrastructureService(db, { NODE_ENV: 'production' } as any).storage();
    expect(r.media).toMatchObject({ store: 'disk', bucket: null, productionSafe: false, diskAccepted: false });
    expect((await new PlatformInfrastructureService(db, { MEDIA_STORE_ALLOW_DISK: '1' } as any).storage()).media.productionSafe).toBe(true);
  });
  it('without a database the panel is told so', async () => {
    const r = await new PlatformInfrastructureService(null, {} as any).storage();
    expect(r.database).toMatchObject({ available: false, reason: 'no database', sizeBytes: null });
  });
});

describe('deployments', () => {
  it('the running build, its uptime, and the migration ledger newest first', async () => {
    const t0 = Date.parse('2026-10-21T10:00:00Z');
    const r = await new PlatformInfrastructureService(db, {} as any, t0).deployments(t0 + 90_000);
    expect(r.uptimeSeconds).toBe(90);
    expect(typeof r.build.version).toBe('string');
    expect(r.migrations.available).toBe(true);
    expect(r.migrations.recent[0].filename).toBe('671_rollout_flags_tap_to_pay_payroll.sql');
    expect(r.migrations.recent.map((m) => m.filename)).toContain('001_init.sql');
  });
  it('without a database: build and uptime still answer, the ledger says why it cannot', async () => {
    const r = await new PlatformInfrastructureService(null, {} as any).deployments();
    expect(r.schema).toBeNull();
    expect(r.migrations).toMatchObject({ available: false, reason: 'no database', recent: [] });
  });
});
