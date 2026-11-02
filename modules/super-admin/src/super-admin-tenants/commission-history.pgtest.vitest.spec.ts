// commission-history.pgtest.vitest.spec.ts — SCAN (Oct 12 2026), found by the real-browser run of Super Admin against a
// copy of the local database: GET /super-admin/commission-oversight logged "operator does not exist: text = uuid" on every
// visit and answered an EMPTY history. Migration 539 made commission_change_audit_logs.tenant_id a uuid (technician_id
// stays text); the join compared `t.id::text = c.tenant_id`. Mocked tests never meet Postgres type resolution, so this
// runs the query on a real engine with the SAME column split (tenant_id uuid, technician_id text).
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { fetchCommissionHistory } from './commission-history.query';

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

const T = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', TECH = 'cccccccc-cccc-cccc-cccc-cccccccccccd';
let db: Kysely<any>;
beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(`
    create table tenants (id uuid primary key, display_name text);
    create table technicians (id uuid primary key, full_name text, email text);
    create table commission_change_audit_logs (id uuid primary key, tenant_id uuid, technician_id text, target_type text,
      old_commission_percent numeric, new_commission_percent numeric, requested_by_name text, requested_by_role text,
      authorized_by_name text, auth_code_used boolean, created_at timestamptz default now());`);
  await pg.query(`insert into tenants values ($1, 'Pilot Nails')`, [T]);
  await pg.query(`insert into technicians values ($1, 'Mai Tran', 'mai@pilot.test')`, [TECH]);
  await pg.query(`insert into commission_change_audit_logs (id, tenant_id, technician_id, target_type, old_commission_percent, new_commission_percent, requested_by_name, requested_by_role, authorized_by_name, auth_code_used)
                  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', $1, $2, 'technician', 50, 55, 'Owner', 'OWNER', 'Super Admin', true)`, [T, TECH]);
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
});

describe('commission-change history (Super Admin oversight)', () => {
  it('joins the salon and technician across the uuid / text column split and returns the change', async () => {
    const rows = await fetchCommissionHistory(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantName: 'Pilot Nails', techName: 'Mai Tran', requestedByRole: 'OWNER' });
    expect(Number(rows[0].newCommissionPercent)).toBe(55);
  });
});
