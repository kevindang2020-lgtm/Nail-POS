// Integration test for KyselyDeviceMgmtRepo against a REAL Postgres. It self-provisions its own tables in a
// throwaway `device_it` schema, so it is safe to run against any test database. It SKIPS cleanly when no
// TEST_DATABASE_URL is configured (the default unit env has no Postgres) — so it never breaks the normal
// suite, but proves query correctness (columns, UUID/TEXT casts, joins, tenant isolation) wherever a DB is
// available. Verified passing locally against Postgres 16.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';

const URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;
const run = URL ? describe : describe.skip;

run('KyselyDeviceMgmtRepo — real Postgres integration', () => {
  let db: Kysely<any>;
  let repo: any;

  beforeAll(async () => {
    const pg = await import('pg');
    // Bootstrap the schema on a plain connection first…
    const boot = new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.default.Pool({ connectionString: URL }) }) });
    await sql`drop schema if exists device_it cascade`.execute(boot);
    await sql`create schema device_it`.execute(boot);
    await boot.destroy();
    // …then use a pool where EVERY connection resolves unqualified names to device_it.
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.default.Pool({ connectionString: URL, options: '-c search_path=device_it' }) }) });
    await sql`create extension if not exists "pgcrypto"`.execute(db);
    await sql`
      create table tenants (id uuid primary key default gen_random_uuid(), legal_name text, display_name text);
      create table branches (id uuid primary key default gen_random_uuid(), tenant_id uuid, name text);
      create table customer_display_devices (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, pos_station_id uuid, device_name text, device_type text, pairing_status text, last_seen_at timestamptz, revoked_at timestamptz);
      create table go_checkin_devices (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, device_name text, device_type text, status text, last_seen_at timestamptz, disabled_at timestamptz);
      create table pos_payment_terminals (id text, tenant_id text, branch_id text, label text, station_id text, status text, paired_at timestamptz);
      create table device_catalog (device_type text, display_name text, model_count int, availability text, sort_order int);
      create table device_shipments (shipment_reference text, device_label text, device_type text, destination_branch text, status text, eta_at timestamptz, created_at timestamptz default now());
      create table device_maintenance (ticket_reference text, device_label text, branch_name text, status text, expected_return_at timestamptz, created_at timestamptz default now());
      create table device_security_alerts (device_label text, tenant_name text, issue text, severity text, status text, last_action text, updated_at timestamptz default now());
    `.execute(db);
    await sql`
      insert into tenants (id, display_name) values ('11111111-1111-1111-1111-111111111111','AI PowerSalon');
      insert into branches (id, tenant_id, name) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Downtown Branch');
      insert into customer_display_devices (tenant_id, branch_id, device_name, device_type, pairing_status, last_seen_at, revoked_at)
        values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Front Display','ipad_mini','paired', now(), null),
               ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Old Display','ipad_mini','revoked', now(), now());
      insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, status, last_seen_at)
        values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Kiosk A','kiosk','active', now());
      insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, paired_at)
        values ('TERM-001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Front Terminal','paired', now());
      insert into device_catalog values ('reception_pos','Reception POS',12,'available',1);
      insert into device_shipments (shipment_reference, device_label, destination_branch, status, eta_at) values ('SHIP-1','iPad Kiosk','Midtown','in_transit', now());
      insert into device_maintenance (ticket_reference, device_label, branch_name, status, expected_return_at) values ('TIC-1','Printer','Downtown','in_progress', now());
      insert into device_security_alerts (device_label, tenant_name, issue, severity, status, last_action) values ('Kiosk A','AI PowerSalon','Rooted Device','high','open','2026-05-06T13:20');
    `.execute(db);

    // search_path is set on the pool connection; the repo uses unqualified table names.
    const mod = await import('./device-management.kysely.repository');
    repo = new mod.KyselyDeviceMgmtRepo(db as any);
  });

  afterAll(async () => {
    if (db) { await sql`drop schema if exists device_it cascade`.execute(db).catch(() => {}); await db.destroy(); }
  });

  it('listDevices returns real devices from all three inventory sources with joined names', async () => {
    const devices = await repo.listDevices({});
    expect(devices.length).toBe(4);
    const types = devices.map((d: any) => d.type).sort();
    expect(types).toEqual(['check_in_kiosk', 'customer_display', 'customer_display', 'payment_terminal']);
    for (const d of devices) { expect(d.branchName).toBe('Downtown Branch'); expect(d.tenantName).toBe('AI PowerSalon'); }
    // unmodeled fields are honest nulls, never fabricated
    for (const d of devices) { expect(d.serial).toBeNull(); expect(d.os).toBeNull(); expect(d.updateStatus).toBeNull(); }
    // the payment terminal joined despite TEXT ids vs UUID branch/tenant
    expect(devices.find((d: any) => d.type === 'payment_terminal')?.branchName).toBe('Downtown Branch');
  });

  it('counts reflects real aggregates (revoked device counted as locked/revoked)', async () => {
    const c = await repo.counts({});
    expect(c.lockedOrRevoked).toBe(1);
    expect(c.merchantTerminalsConnected).toBe(1);
    expect(c.shipmentsPending).toBe(1);
    expect(c.maintenanceActive).toBe(1);
  });

  it('greenfield tables (catalog/shipments/maintenance/security) return seeded rows', async () => {
    expect((await repo.catalog()).length).toBe(1);
    expect((await repo.shipments())[0].reference).toBe('SHIP-1');
    expect((await repo.maintenance())[0].reference).toBe('TIC-1');
    expect((await repo.securityAlerts())[0].severity).toBe('high');
  });

  it('tenant scope isolates results', async () => {
    expect((await repo.listDevices({ tenantId: '11111111-1111-1111-1111-111111111111' })).length).toBe(4);
    expect((await repo.listDevices({ tenantId: '99999999-9999-9999-9999-999999999999' })).length).toBe(0);
  });
});
