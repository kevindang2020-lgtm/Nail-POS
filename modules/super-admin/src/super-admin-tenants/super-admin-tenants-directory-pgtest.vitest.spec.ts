// super-admin-tenants-directory-pgtest.vitest.spec.ts — REAL-DB regression guard for the tenant-directory listing.
//
// Runtime bug this pins: LIST_SQL counts POS devices via
//   (SELECT count(*) FROM pos_payment_terminals p WHERE p.tenant_id = t.id ...)
// but pos_payment_terminals.tenant_id is TEXT (composite PK (tenant_id, id)) while tenants.id is UUID. On real
// Postgres that comparison is `text = uuid`, which has no operator → every GET /super-admin/tenants/{state,
// directory-overview} 500s ("operator does not exist: text = uuid"). Mocked unit tests never hit Postgres type
// resolution, so the fix (cast t.id::text, matching the cast the merchant-accounts repo already uses) must be
// guarded by a query that runs against a real engine with the SAME text/uuid column split.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselySuperAdminTenantsRepo } from './super-admin-tenants.kysely.repository';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(c: any) { const r = await pg.query(c.sql, c.parameters as any[]); return { rows: r.rows as any[] }; }, async *streamQuery() {} };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

let pg: PGlite;
let db: Kysely<any>;
const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;').catch(() => {});
  // Minimal schema LIST_SQL reads. The critical detail: pos_payment_terminals.tenant_id is TEXT (as in prod),
  // while tenants.id is UUID — reproducing the exact cross-type join the query performs.
  await pg.exec(`
    create table tenants (id uuid primary key, display_name text, tenant_code text, status text, lifecycle_state text, suspension_reason_code text,
      created_at timestamptz default now(), owner_user_id uuid);
    create table users (id uuid primary key, full_name text, email text, normalized_phone text,
      last_login_at timestamptz, password_hash text);
    create table tenant_subscriptions (id uuid primary key default gen_random_uuid(), tenant_id uuid, plan text,
      status text, current_period_end timestamptz, created_at timestamptz default now());
    create table tenant_ai_packages (id uuid primary key default gen_random_uuid(), tenant_id uuid, package text,
      created_at timestamptz default now());
    create table tenant_payment_config (tenant_id uuid primary key, fiserv_configured boolean, status text);
    create table tenant_hardware_payoff (tenant_id uuid primary key, remaining_cents bigint);
    create table branches (id uuid primary key default gen_random_uuid(), tenant_id uuid, city text, state text,
      created_at timestamptz default now());
    create table tenant_usage_limits (tenant_id uuid, metric text, used_value bigint, limit_value bigint);
    create table pos_payment_terminals (tenant_id text not null, id text not null, status text, branch_id text,
      label text, primary key (tenant_id, id));`);
  await pg.query(`insert into tenants (id, display_name, tenant_code, status, owner_user_id) values ($1,'Pilot Nail Salon','PILOT01','active',$2)`, [T, OWNER]);
  await pg.query(`insert into users (id, full_name, email, password_hash) values ($1,'Owner','owner@pilot.test','x')`, [OWNER]);
  await pg.query(`insert into branches (tenant_id, city, state) values ($1,'Cherry Hill','NJ')`, [T]);
  // tenant_id stored as the UUID's text form — the realistic case the cast must handle.
  await pg.query(`insert into pos_payment_terminals (tenant_id, id, status) values ($1,'term-1','active'),($1,'term-2','active'),($1,'term-3','inactive')`, [T]);

  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('super-admin tenants directory (real PGlite: text tenant_id vs uuid tenants.id)', () => {
  it('listTenantRecords() executes the text/uuid POS-device join without a type error', async () => {
    const repo = new KyselySuperAdminTenantsRepo(db);
    const rows = await repo.listTenantRecords(); // throws "operator does not exist: text = uuid" if the cast regresses
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantCode).toBe('PILOT01');
    // 2 of 3 terminals are active → the cross-type join must resolve and count correctly.
    expect(rows[0].posDeviceCount).toBe(2);
  });

  it('getTenantRecord(id) (same LIST_SQL, single-tenant path) also resolves the join', async () => {
    const repo = new KyselySuperAdminTenantsRepo(db);
    const rec = await repo.getTenantRecord(T);
    expect(rec).not.toBeNull();
    expect(rec!.posDeviceCount).toBe(2);
    expect(rec!.primaryCity).toBe('Cherry Hill');
  });
});
