// compensation-rule-loader.pgtest.vitest.spec.ts — proves the rule store + resolver against real SQL (spec §4/§5). Seeds
// authored policies/versions in migration 409's tables and checks: the most-specific rule wins, a non-matching context
// falls through to the salon default, a tenant with no rules resolves to NULL (caller keeps service-default), and a
// draft version never takes effect. Applies only migration 409 (the tables are self-contained).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { loadEffectiveRules, resolveLineCommission } from './compensation-rule-loader';

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

const T = 'aa000000-0000-0000-0000-000000000001';   // tenant with rules
const T2 = 'aa000000-0000-0000-0000-000000000002';  // tenant with no rules
const B1 = 'aa000000-0000-0000-0000-0000000000b1';
const TECH1 = 'aa000000-0000-0000-0000-0000000000c1';
const SVC1 = 'aa000000-0000-0000-0000-0000000000d1';
const P_TENANT = 'aa000000-0000-0000-0000-0000000000e1';
const P_TS = 'aa000000-0000-0000-0000-0000000000e2';
const P_DRAFT = 'aa000000-0000-0000-0000-0000000000e3';

let pg: PGlite;
let db: Kysely<any>;

beforeAll(async () => {
  pg = await PGlite.create();
  const sql = readFileSync(`${MIGRATIONS_DIR}/409_compensation_policies.sql`, 'utf8');
  await pg.exec(sql);
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  const pol = (id: string, cols: Record<string, string | null>) =>
    pg.query(`insert into compensation_policies (id, tenant_id, branch_id, technician_id, service_id, service_category, ticket_id) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, T, cols.branch_id ?? null, cols.technician_id ?? null, cols.service_id ?? null, cols.service_category ?? null, cols.ticket_id ?? null]);
  const ver = (policyId: string, value: number, status: string) =>
    pg.query(`insert into compensation_policy_versions (policy_id, tenant_id, version, commission_type, commission_value, status, effective_start, approved) values ($1,$2,1,'percent',$3,$4, now() - interval '10 days', true)`,
      [policyId, T, value, status]);
  await pol(P_TENANT, {});                                             // salon default
  await ver(P_TENANT, 60, 'active');
  await pol(P_TS, { technician_id: TECH1, service_id: SVC1 });         // technician + service override
  await ver(P_TS, 70, 'active');
  await pol(P_DRAFT, {});                                              // another salon default, but DRAFT → must be ignored
  await ver(P_DRAFT, 99, 'draft');
});

describe('compensation rule loader + resolver (§4/§5)', () => {
  it('loads only live versions (draft excluded)', async () => {
    const rules = await loadEffectiveRules(db, T);
    expect(rules.map((r) => r.commission!.value).sort((a, b) => a - b)).toEqual([60, 70]); // 99 draft not loaded
  });

  it('resolves the most-specific rule (technician + service) for a matching line', async () => {
    const got = await resolveLineCommission(db, { tenantId: T, technicianId: TECH1, serviceId: SVC1, branchId: B1, serviceCategory: 'nails' });
    expect(got).toMatchObject({ commissionType: 'percent', commissionValue: 70, source: 'Technician + Service' });
  });

  it('falls through to the salon default for a non-matching technician/service', async () => {
    const got = await resolveLineCommission(db, { tenantId: T, technicianId: 'aa000000-0000-0000-0000-0000000000cf', serviceId: 'aa000000-0000-0000-0000-0000000000df' });
    expect(got).toMatchObject({ commissionValue: 60, source: 'Salon Default' });
  });

  it('returns null for a tenant with no authored rules (caller uses service-default)', async () => {
    expect(await resolveLineCommission(db, { tenantId: T2, technicianId: TECH1, serviceId: SVC1 })).toBeNull();
  });
});
