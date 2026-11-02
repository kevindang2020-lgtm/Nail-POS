// compensation-compliance-period.pgtest.vitest.spec.ts — reviewPeriod reads a built payroll period's persisted lines +
// worked hours from shifts and flags wage exceptions, changing nothing. An employee paid below minimum wage is flagged;
// a contractor is not. Uses minimal payroll_periods / payroll_lines / technician_shifts / technician_classifications /
// tenant_settings tables.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
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

const T = 'eb000000-0000-0000-0000-000000000001';
const PERIOD = 'eb000000-0000-0000-0000-0000000000a1';
const TECH1 = 'eb000000-0000-0000-0000-0000000000c1'; // employee, underpaid
const TECH2 = 'eb000000-0000-0000-0000-0000000000c2'; // contractor
const ctx = { tenantId: T, branchId: null, userId: 'eb000000-0000-0000-0000-0000000000f1' };
let svc: ComplianceService;

beforeAll(async () => {
  const pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  await pg.exec(`CREATE TABLE payroll_periods (id uuid primary key, tenant_id uuid, branch_id uuid, period_start date, period_end date, status text default 'finalized')`);
  await pg.exec(`CREATE TABLE payroll_lines (id uuid primary key default gen_random_uuid(), period_id uuid, tenant_id uuid, technician_id uuid, technician_name text, payable_cents bigint)`);
  await pg.exec(`CREATE TABLE technician_shifts (id uuid primary key default gen_random_uuid(), tenant_id uuid, technician_id uuid, shift_date date, start_time timestamptz, end_time timestamptz, status text default 'completed')`);
  await pg.exec(`CREATE TABLE technician_classifications (id uuid primary key default gen_random_uuid(), tenant_id uuid, technician_id uuid, classification text default 'employee', set_by uuid, updated_at timestamptz default now(), created_at timestamptz default now(), UNIQUE(tenant_id, technician_id))`);
  await pg.exec(`CREATE TABLE tenant_settings (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, category text, settings_json jsonb, updated_by_user_id uuid, updated_at timestamptz default now(), created_at timestamptz default now())`);
  await pg.query(`INSERT INTO payroll_periods (id, tenant_id, period_start, period_end) VALUES ($1,$2,'2026-01-01','2026-01-31')`, [PERIOD, T]);
  await pg.query(`INSERT INTO payroll_lines (period_id, tenant_id, technician_id, technician_name, payable_cents) VALUES ($1,$2,$3,'Alex',30000),($1,$2,$4,'Sam',100000)`, [PERIOD, T, TECH1, TECH2]);
  // TECH1 worked 40h in period (one 40h span). $300 / 40h = $7.50/h.
  await pg.query(`INSERT INTO technician_shifts (tenant_id, technician_id, shift_date, start_time, end_time) VALUES ($1,$2,'2026-01-15','2026-01-15T00:00:00Z','2026-01-16T16:00:00Z')`, [T, TECH1]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new ComplianceService(new KyselyClassificationRepo(db as any), db as any);
  await svc.setClassification(ctx, TECH1, 'employee');
  await svc.setClassification(ctx, TECH2, 'contractor');
  await svc.setWageConfig(ctx, { minHourlyWageCents: 1500, overtimeThresholdHours: 40 });
});

describe('ComplianceService.reviewPeriod (read-only, real PG)', () => {
  it('flags the underpaid employee and clears the contractor', async () => {
    const rows = await svc.reviewPeriod(ctx, PERIOD);
    expect(rows).toHaveLength(2);
    const alex = rows.find((r) => r.technicianId === TECH1)!;
    expect(alex).toMatchObject({ technicianName: 'Alex', classification: 'employee', payableCents: 30000, hoursWorked: 40 });
    expect(alex.flags.some((f) => f.code === 'below_minimum_wage')).toBe(true);
    const sam = rows.find((r) => r.technicianId === TECH2)!;
    expect(sam.classification).toBe('contractor');
    expect(sam.flags).toHaveLength(0); // contractor — wage rules don't apply
  });

  it('404s an unknown period', async () => {
    await expect(svc.reviewPeriod(ctx, 'eb000000-0000-0000-0000-0000000000ff')).rejects.toThrow(/not found/i);
  });
});
