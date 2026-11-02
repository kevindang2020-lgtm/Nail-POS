// compensation-guarantee-facts.pgtest.vitest.spec.ts — PayrollAutoBuildAdapter.periodFacts derives guarantee
// eligibility/proration facts from REAL technician_shifts rows (worked hours from punches, eligible vs scheduled
// days), scoped to tenant + period + optional branch. scheduledHours is deliberately never supplied (the schema does
// not model it), and "nothing on record" resolves to null so the engine's fail-safe pays the full guarantee with a
// note — never a silent $0. Table shape mirrors migration 012_overview.sql.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { PayrollAutoBuildAdapter } from './compensation-autobuild.adapter';

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

const T = 'fa000000-0000-0000-0000-000000000001';
const T2 = 'fa000000-0000-0000-0000-000000000002';
const B1 = 'fa000000-0000-0000-0000-0000000000b1';
const B2 = 'fa000000-0000-0000-0000-0000000000b2';
const TECH = 'fa000000-0000-0000-0000-0000000000c1';
const TECH_SCHED = 'fa000000-0000-0000-0000-0000000000c9';
let adapter: PayrollAutoBuildAdapter;

beforeAll(async () => {
  const pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  await pg.exec(`CREATE TABLE technician_shifts (
    id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null,
    technician_id uuid not null, shift_date date not null, start_time timestamptz, end_time timestamptz,
    status text not null default 'scheduled', created_at timestamptz not null default now())`);
  // In-period (Jul 1–7) at B1: two worked days (6h + 4h = 10h), one scheduled-only day (no punches).
  // Same tech: one worked day at B2 (2h), one worked day OUT of period, and a row for ANOTHER tenant.
  await pg.query(`INSERT INTO technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) VALUES
    ($1,$3,$5,'2026-07-01','2026-07-01T09:00:00Z','2026-07-01T15:00:00Z','completed'),
    ($1,$3,$5,'2026-07-02','2026-07-02T10:00:00Z','2026-07-02T14:00:00Z','completed'),
    ($1,$3,$5,'2026-07-03',NULL,NULL,'scheduled'),
    ($1,$4,$5,'2026-07-04','2026-07-04T09:00:00Z','2026-07-04T11:00:00Z','completed'),
    ($1,$3,$5,'2026-06-20','2026-06-20T09:00:00Z','2026-06-20T17:00:00Z','completed'),
    ($2,$3,$5,'2026-07-02','2026-07-02T09:00:00Z','2026-07-02T17:00:00Z','completed')`,
    [T, T2, B1, B2, TECH]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  // Weekly template + blocked windows (migrations 003/035 shapes). TECH gets NO template rows, so the original
  // punch-derived expectations above stay valid — pinning the layering: template absent → scheduledHours undefined.
  await pg.exec(`CREATE TABLE technician_schedules (
    id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null,
    technician_id uuid not null, day_of_week smallint not null, start_time time not null, end_time time not null,
    lunch_start_time time, lunch_end_time time, is_working boolean not null default true)`);
  await pg.exec(`CREATE TABLE technician_blocked_times (
    id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid not null,
    technician_id uuid not null, block_date date not null, start_time text not null, end_time text not null)`);
  // TECH_SCHED: Wed+Thu 09:00–17:00 with a 12–13 lunch (7h/day) at B1, plus one worked punch (Jul 1, 6h)
  // and a 2h block on Thu Jul 2.
  await pg.query(`INSERT INTO technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) VALUES
    ($1,$2,$3,3,'09:00','17:00','12:00','13:00',true),
    ($1,$2,$3,4,'09:00','17:00','12:00','13:00',true)`, [T, B1, TECH_SCHED]);
  await pg.query(`INSERT INTO technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time) VALUES
    ($1,$2,$3,'2026-07-02','14:00','16:00')`, [T, B1, TECH_SCHED]);
  await pg.query(`INSERT INTO technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) VALUES
    ($1,$2,$3,'2026-07-01','2026-07-01T09:00:00Z','2026-07-01T15:00:00Z','completed')`, [T, B1, TECH_SCHED]);
  adapter = new PayrollAutoBuildAdapter(db as any);
});

describe('guarantee period facts from technician_shifts (real PG)', () => {
  it('tenant-wide period: worked hours sum punches, eligible vs scheduled days split, other tenant excluded', async () => {
    const f = await adapter.periodFacts(T, TECH, '2026-07-01', '2026-07-07', null);
    expect(f).not.toBeNull();
    expect(f!.hoursWorked).toBeCloseTo(12, 5);      // 6 + 4 (B1) + 2 (B2); out-of-period + other tenant excluded
    expect(f!.eligibleHours).toBeCloseTo(12, 5);
    expect(f!.eligibleDays).toBe(3);                // 3 distinct worked dates
    expect(f!.scheduledDays).toBe(4);               // + the punch-less scheduled day
    expect(f!.clockedIn).toBe(true);
    expect(f!.scheduledHours).toBeUndefined();      // never fabricated — the schema does not model it
  });

  it('branch-scoped period only counts that branch', async () => {
    const f = await adapter.periodFacts(T, TECH, '2026-07-01', '2026-07-07', B1);
    expect(f!.hoursWorked).toBeCloseTo(10, 5);
    expect(f!.eligibleDays).toBe(2);
    expect(f!.scheduledDays).toBe(3);
  });

  it('nothing on record → null (the engine fail-safe then pays the full guarantee, not $0)', async () => {
    expect(await adapter.periodFacts(T, 'fa000000-0000-0000-0000-0000000000ff', '2026-07-01', '2026-07-07', null)).toBeNull();
  });

  it('Date-object period bounds are handled (payroll DATE columns come back as Date or string)', async () => {
    const f = await adapter.periodFacts(T, TECH, new Date('2026-07-01T00:00:00Z') as unknown as string, new Date('2026-07-07T00:00:00Z') as unknown as string, null);
    expect(f!.eligibleDays).toBe(3);
  });
});

describe('scheduled hours layered from the weekly template (real PG)', () => {
  it('template present: scheduledHours from template minus blocks; scheduledDays becomes the template denominator', async () => {
    const f = await adapter.periodFacts(T, TECH_SCHED, '2026-07-01', '2026-07-07', null);
    // Wed 7h + (Thu 7h - 2h block) = 12h over 2 template days; punches still drive worked figures.
    expect(f!.scheduledHours).toBeCloseTo(12, 5);
    expect(f!.scheduledDays).toBe(2);
    expect(f!.hoursWorked).toBeCloseTo(6, 5);
    expect(f!.eligibleDays).toBe(1);
  });

  it('template absent: scheduledHours stays undefined and scheduledDays stays punch-derived (the original TECH)', async () => {
    const f = await adapter.periodFacts(T, TECH, '2026-07-01', '2026-07-07', null);
    expect(f!.scheduledHours).toBeUndefined();
    expect(f!.scheduledDays).toBe(4);
  });
});
