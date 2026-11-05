// super-admin-compensation.pgtest.vitest.spec.ts — §27 against real PG: the overview aggregates each tenant's
// compensation config and omits tenants with none. Applies the config migrations (409/411/412/413/414) + a minimal
// tenants table.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { SuperAdminCompensationService } from './super-admin-compensation.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() { const pg = this.pg; return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('nu'); } } as any; }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T1 = 'ef000000-0000-0000-0000-000000000001';
const T2 = 'ef000000-0000-0000-0000-000000000002';
const TECH = 'ef000000-0000-0000-0000-0000000000c1';
let svc: SuperAdminCompensationService;

beforeAll(async () => {
  const pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  for (const f of ['409_compensation_policies.sql', '411_technician_tier_plans.sql', '412_bonus_rules.sql', '413_technician_classifications.sql', '414_compensation_agreements.sql']) {
    const sqlText = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
    for (const stmt of sqlText.split(/;\s*\n/)) { try { await pg.exec(stmt); } catch { /* tolerate */ } }
  }
  await pg.exec('CREATE TABLE tenants (id UUID PRIMARY KEY, display_name TEXT)');
  await pg.query('INSERT INTO tenants (id, display_name) VALUES ($1,$2),($3,$4)', [T1, 'Salon A', T2, 'Salon B']);
  // T1 config: 1 tier plan, 1 bonus rule, 1 classification, 2 agreements (1 acknowledged). T2: none.
  await pg.query(`INSERT INTO technician_tier_plans (tenant_id, technician_id, mode, bands_json, status) VALUES ($1,$2,'entire','[]'::jsonb,'active')`, [T1, TECH]);
  await pg.query(`INSERT INTO bonus_rules (tenant_id, metric, target_value, amount_cents, status) VALUES ($1,'service_production',500000,20000,'active')`, [T1]);
  await pg.query(`INSERT INTO technician_classifications (tenant_id, technician_id, classification) VALUES ($1,$2,'employee')`, [T1, TECH]);
  await pg.query(`INSERT INTO compensation_agreements (tenant_id, technician_id, title, status) VALUES ($1,$2,'v1','acknowledged'),($1,$2,'v2','sent')`, [T1, TECH]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new SuperAdminCompensationService(db as any);
});

describe('SuperAdminCompensationService.overview (§27, real PG)', () => {
  // Developer (Sep 2026): the overview lists EVERY salon, so a Super Admin can see which have no compensation set up
  // (it used to hide them). The configured salon's counts are unchanged; the empty one reads all zeros — nothing invented.
  it('summarizes the configured tenant and lists the empty one with zero counts', async () => {
    const rows = await svc.overview();
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.tenantId === T1)).toMatchObject({
      tenantId: T1, tenantName: 'Salon A',
      activeRules: 0, tierPlans: 1, bonusRules: 1, classifications: 1, agreements: 2, acknowledgedAgreements: 1,
    });
    const empty: any = rows.find((r: any) => r.tenantId !== T1);
    expect(empty).toMatchObject({ activeRules: 0, tierPlans: 0, bonusRules: 0, classifications: 0, agreements: 0, acknowledgedAgreements: 0 });
  });
});
