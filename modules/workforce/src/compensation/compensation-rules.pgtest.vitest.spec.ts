// compensation-rules.pgtest.vitest.spec.ts — proves the authoring lifecycle against real PG (spec §25) AND that it
// closes the loop with Phase 1: a rule authored + activated here is what the resolver (compensation-rule-loader) then
// returns. Activating a new version supersedes the prior active one (transactional) so historical resolution stays
// stable. Applies only migration 409 (the tables are self-contained).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyCompensationRulesRepo } from './compensation-rules.repository';
import { CompensationRulesService } from './compensation-rules.service';
import { resolveLineCommission } from './compensation-rule-loader';

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

const T = 'ca000000-0000-0000-0000-000000000001';
const ctx = { tenantId: T, branchId: null, userId: 'ca000000-0000-0000-0000-0000000000f1' };
const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

let pg: PGlite;
let db: Kysely<any>;
let svc: CompensationRulesService;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/409_compensation_policies.sql`, 'utf8'));
  db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new CompensationRulesService(new KyselyCompensationRulesRepo(db as any));
});

describe('compensation rules lifecycle on real PG (§25) + resolver hand-off', () => {
  it('authors a salon-default rule, activates it, and the resolver returns it', async () => {
    const p = await svc.createPolicy(ctx, { scope: {}, label: 'Salon default', version: { commissionType: 'percent', commissionValue: 60, effectiveStart: past(10) } });
    expect(p.versions[0].status).toBe('draft');
    await svc.activate(ctx, p.versions[0].id);
    // Phase 1 resolver now sees the active rule
    const r1 = await resolveLineCommission(db as any, { tenantId: T, serviceId: 'ca000000-0000-0000-0000-0000000000d1' });
    expect(r1).toMatchObject({ commissionValue: 60, source: 'Salon Default' });
  });

  it('activating a new version supersedes the prior one and the resolver switches to it', async () => {
    const list = await svc.list(ctx);
    const policyId = list[0].id;
    const v1 = list[0].versions.find((x) => x.status === 'active')!;
    const v2 = await svc.addVersion(ctx, policyId, { commissionType: 'percent', commissionValue: 65, effectiveStart: past(1) });
    await svc.approve(ctx, v2.id);
    await svc.activate(ctx, v2.id);
    // prior version closed + replaced
    const after = await svc.get(ctx, policyId);
    const old = after.versions.find((x) => x.id === v1.id)!;
    expect(old.status).toBe('replaced');
    expect(old.effectiveEnd).toBe(v2.effectiveStart);
    // resolver now returns the new rate
    const r2 = await resolveLineCommission(db as any, { tenantId: T, serviceId: 'ca000000-0000-0000-0000-0000000000d1' });
    expect(r2).toMatchObject({ commissionValue: 65 });
  });
});
