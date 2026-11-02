// device-management.pgtest.vitest.spec.ts — exercises the REAL KyselyDeviceMgmtRepo against PGlite (in-process
// Postgres), so query correctness (columns, UUID-vs-TEXT casts on the payment-terminal join, tenant scoping,
// honest nulls for unmodeled fields) is actually verified in the normal unit env — no external DB required.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyDeviceMgmtRepo } from './device-management.kysely.repository';

// Minimal pglite→Kysely driver: the repo only needs sql``.execute(db).
class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(compiled: any) { const r = await pg.query(compiled.sql, compiled.parameters as any[]); return { rows: r.rows as any[] }; },
      async *streamQuery() { /* unused */ },
    };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

async function makeDb(): Promise<Kysely<any>> {
  const pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* gen_random_uuid is native in pglite */ }
  // Real inventory sources (UUID ids) + payment terminals (TEXT ids) + the migration-246 support tables.
  await pg.exec(`
    create table tenants (id uuid primary key default gen_random_uuid(), legal_name text, display_name text);
    create table branches (id uuid primary key default gen_random_uuid(), tenant_id uuid, name text);
    create table customer_display_devices (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, pos_station_id uuid, device_name text, device_type text, pairing_status text, last_seen_at timestamptz, revoked_at timestamptz);
    create table go_checkin_devices (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, device_name text, device_type text, status text, last_seen_at timestamptz, disabled_at timestamptz);
    create table pos_payment_terminals (id text, tenant_id text, branch_id text, label text, station_id text, status text, paired_at timestamptz);
    create table device_catalog (device_type text, display_name text, model_count int, availability text, sort_order int);
    create table device_shipments (shipment_reference text, device_label text, device_type text, destination_branch text, status text, eta_at timestamptz, created_at timestamptz default now());
    create table device_maintenance (ticket_reference text, device_label text, branch_name text, status text, expected_return_at timestamptz, created_at timestamptz default now());
    create table device_security_alerts (device_label text, tenant_name text, issue text, severity text, status text, last_action text, updated_at timestamptz default now());
  `);
  await pg.exec(`
    insert into tenants (id, display_name) values ('11111111-1111-1111-1111-111111111111','AI PowerSalon'), ('99999999-9999-9999-9999-999999999999','Other Tenant');
    insert into branches (id, tenant_id, name) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Downtown Branch');
    insert into customer_display_devices (tenant_id, branch_id, device_name, device_type, pairing_status, last_seen_at, revoked_at) values
      ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Front Display','ipad_mini','paired', now(), null),
      ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Old Display','ipad_mini','revoked', now(), now());
    insert into go_checkin_devices (tenant_id, branch_id, device_name, device_type, status, last_seen_at) values
      ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Kiosk A','kiosk','active', now());
    insert into pos_payment_terminals (id, tenant_id, branch_id, label, status, paired_at) values
      ('TERM-001','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Front Terminal','paired', now());
    insert into device_catalog values ('reception_pos','Reception POS',12,'available',1);
    insert into device_shipments (shipment_reference, device_label, destination_branch, status, eta_at) values ('SHIP-1','iPad Kiosk','Midtown','in_transit', now());
    insert into device_maintenance (ticket_reference, device_label, branch_name, status, expected_return_at) values ('TIC-1','Printer','Downtown','in_progress', now());
    insert into device_security_alerts (device_label, tenant_name, issue, severity, status, last_action) values ('Kiosk A','AI PowerSalon','Rooted Device','high','open','2026-05-06T13:20');
  `);
  return new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
}

describe('KyselyDeviceMgmtRepo (pglite integration)', () => {
  let repo: KyselyDeviceMgmtRepo;
  beforeAll(async () => { repo = new KyselyDeviceMgmtRepo(await makeDb() as any); });

  it('listDevices unions all three inventory sources with joined tenant/branch names', async () => {
    const devices = await repo.listDevices({});
    expect(devices.length).toBe(4);
    expect(devices.map((d) => d.type).sort()).toEqual(['check_in_kiosk', 'customer_display', 'customer_display', 'payment_terminal']);
    for (const d of devices) { expect(d.branchName).toBe('Downtown Branch'); expect(d.tenantName).toBe('AI PowerSalon'); }
  });

  it('returns honest nulls for unmodeled per-device fields (never fabricated)', async () => {
    for (const d of await repo.listDevices({})) {
      expect(d.serial).toBeNull(); expect(d.os).toBeNull(); expect(d.appVersion).toBeNull();
      expect(d.securityStatus).toBeNull(); expect(d.updateStatus).toBeNull();
    }
  });

  it('joins the TEXT-id payment terminal to UUID branch/tenant correctly', async () => {
    const term = (await repo.listDevices({})).find((d) => d.type === 'payment_terminal');
    expect(term?.branchName).toBe('Downtown Branch');
    expect(term?.tenantName).toBe('AI PowerSalon');
    expect(term?.merchantTerminalId).toBe('TERM-001');
  });

  it('counts reflects real aggregates', async () => {
    const c = await repo.counts({});
    expect(c.lockedOrRevoked).toBe(1);       // the revoked display
    expect(c.merchantTerminalsConnected).toBe(1);
    expect(c.shipmentsPending).toBe(1);
    expect(c.maintenanceActive).toBe(1);
  });

  it('greenfield tables (catalog/shipments/maintenance/security) return real rows', async () => {
    expect((await repo.catalog())[0].displayName).toBe('Reception POS');
    expect((await repo.shipments())[0].reference).toBe('SHIP-1');
    expect((await repo.maintenance())[0].reference).toBe('TIC-1');
    expect((await repo.securityAlerts())[0].severity).toBe('high');
  });

  it('tenant scope isolates results', async () => {
    expect((await repo.listDevices({ tenantId: '11111111-1111-1111-1111-111111111111' })).length).toBe(4);
    expect((await repo.listDevices({ tenantId: '99999999-9999-9999-9999-999999999999' })).length).toBe(0);
  });
});
