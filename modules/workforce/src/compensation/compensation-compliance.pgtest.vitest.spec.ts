// compensation-compliance.pgtest.vitest.spec.ts — §18 against real PG: (1) classification upserts (one row per tech,
// updated in place); (2) end-to-end — set the salon minimum wage, classify a technician as employee, and preview their
// period pay → a below-minimum-wage flag surfaces. Applies migrations 413 (classifications) + 016 (tenant_settings).
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { KyselyClassificationRepo } from './compensation-classification.repository';
import { ComplianceService } from './compensation-compliance.service';

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

async function applyTolerant(pg: PGlite, file: string) {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '');
  for (const stmt of sql.split(/;\s*\n/)) { try { await pg.exec(stmt); } catch { /* tolerate cross-migration deps */ } }
}

const ctx = { tenantId: 'ed000000-0000-0000-0000-000000000001', branchId: null, userId: 'ed000000-0000-0000-0000-0000000000f1' };
const TECH = 'ed000000-0000-0000-0000-0000000000c1';
let repo: KyselyClassificationRepo;
let svc: ComplianceService;

beforeAll(async () => {
  const pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  await applyTolerant(pg, '016_settings_center.sql');
  await applyTolerant(pg, '413_technician_classifications.sql');
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  repo = new KyselyClassificationRepo(db as any);
  svc = new ComplianceService(repo, db as any);
});

describe('classification upsert (real PG)', () => {
  it('keeps one row per technician and updates it in place', async () => {
    await repo.set(ctx, TECH, 'contractor');
    await repo.set(ctx, TECH, 'employee'); // upsert, not a second row
    const list = await repo.list(ctx);
    expect(list).toHaveLength(1);
    expect(await repo.get(ctx, TECH)).toBe('employee');
  });
});

describe('wage-compliance end-to-end (§18, real PG)', () => {
  it('flags an employee below the configured minimum wage', async () => {
    expect(await svc.setWageConfig(ctx, { minHourlyWageCents: 1500, overtimeThresholdHours: 40 })).toEqual({ minHourlyWageCents: 1500, overtimeThresholdHours: 40 });
    expect(await svc.getWageConfig(ctx)).toEqual({ minHourlyWageCents: 1500, overtimeThresholdHours: 40 }); // round-trips via tenant_settings
    // TECH is already 'employee' from the upsert test; $300 over 40h = $7.50/h < $15.00
    const p = await svc.previewCompliance(ctx, { technicianId: TECH, periodPayCents: 30000, hoursWorked: 40 });
    expect(p.classification).toBe('employee');
    expect(p.flags.some((f) => f.code === 'below_minimum_wage')).toBe(true);
  });
});
