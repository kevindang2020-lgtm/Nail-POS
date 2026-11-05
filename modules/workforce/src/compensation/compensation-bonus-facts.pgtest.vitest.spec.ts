// compensation-bonus-facts.pgtest.vitest.spec.ts — the bonus facts loader derives ratingAvg from the reviews table,
// scoped to the technician and period, and that value drives rating_avg bonus qualification. Uses a minimal reviews
// table (the snapshot source is absent here, so serviceProductionCents simply stays absent — proving the guards are
// independent).
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { makeBonusFactsLoader } from './compensation-bonus-facts.adapter';
import { evaluateBonus } from './compensation-bonus';

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

const T = 'ea000000-0000-0000-0000-000000000001';
const TECH1 = 'ea000000-0000-0000-0000-0000000000c1';
const TECH2 = 'ea000000-0000-0000-0000-0000000000c2';
let loader: ReturnType<typeof makeBonusFactsLoader>;

beforeAll(async () => {
  const pg = await PGlite.create();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto'); } catch { /* */ }
  await pg.exec(`CREATE TABLE reviews (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, technician_id uuid, rating numeric(2,1), created_at timestamptz default now())`);
  // TECH1: two in-period (5.0, 4.0 → avg 4.5), one out-of-period (1.0). TECH2: one (2.0).
  await pg.query(`INSERT INTO reviews (tenant_id, technician_id, rating, created_at) VALUES ($1,$2,5.0,'2026-01-15'),($1,$2,4.0,'2026-01-20'),($1,$2,1.0,'2025-12-01'),($1,$3,2.0,'2026-01-16')`, [T, TECH1, TECH2]);
  await pg.exec(`CREATE TABLE technician_shifts (id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, technician_id uuid, shift_date date, start_time timestamptz, end_time timestamptz, status text default 'scheduled')`);
  // TECH1: two worked days (one duplicated → DISTINCT counts once), a scheduled day with no start_time, and a worked day out of period.
  await pg.query(`INSERT INTO technician_shifts (tenant_id, technician_id, shift_date, start_time, status) VALUES
    ($1,$2,'2026-01-15','2026-01-15T09:00:00Z','completed'),
    ($1,$2,'2026-01-15','2026-01-15T14:00:00Z','completed'),
    ($1,$2,'2026-01-20','2026-01-20T09:00:00Z','active'),
    ($1,$2,'2026-01-22',NULL,'scheduled'),
    ($1,$2,'2025-12-10','2025-12-10T09:00:00Z','completed')`, [T, TECH1]);
  await pg.exec(`CREATE TABLE customer_memberships (id uuid primary key default gen_random_uuid(), tenant_id uuid, assigned_technician_id uuid, status text default 'active', created_at timestamptz default now())`);
  // TECH1: two in-period memberships, one out-of-period. TECH2: one in-period.
  await pg.query(`INSERT INTO customer_memberships (tenant_id, assigned_technician_id, created_at) VALUES
    ($1,$2,'2026-01-10'),($1,$2,'2026-01-25'),($1,$2,'2025-11-01'),($1,$3,'2026-01-12')`, [T, TECH1, TECH2]);
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  loader = makeBonusFactsLoader(db as any);
});

describe('bonus facts — rating_avg from reviews (real PG)', () => {
  it('averages the technician\'s in-period ratings only', async () => {
    const facts = await loader({ tenantId: T, branchId: null } as any, TECH1, '2026-01-01', '2026-01-31');
    expect(facts.ratingAvg).toBeCloseTo(4.5, 5); // (5.0 + 4.0)/2, excludes the Dec review and TECH2
    expect(facts.serviceProductionCents ?? 0).toBe(0); // snapshot source absent here — rating guard held independently
  });

  it('drives rating_avg bonus qualification', async () => {
    const facts = await loader({ tenantId: T, branchId: null } as any, TECH1, '2026-01-01', '2026-01-31');
    const earned = evaluateBonus({ metric: 'rating_avg', target: 4.5, amountCents: 5000, label: 'Top rated' }, facts);
    expect(earned.qualified).toBe(true);
    expect(earned.metricValue).toBeCloseTo(4.5, 5);
    // a higher bar isn't met
    expect(evaluateBonus({ metric: 'rating_avg', target: 4.9, amountCents: 5000 }, facts).qualified).toBe(false);
  });

  it('counts distinct worked days for attendance_days (excludes scheduled-only and out-of-period)', async () => {
    const facts = await loader({ tenantId: T, branchId: null } as any, TECH1, '2026-01-01', '2026-01-31');
    expect(facts.attendanceDays).toBe(2); // Jan 15 (dup) + Jan 20; not the scheduled Jan 22 nor the Dec 10 day
    expect(evaluateBonus({ metric: 'attendance_days', target: 2, amountCents: 3000, label: 'Perfect attendance' }, facts).qualified).toBe(true);
    expect(evaluateBonus({ metric: 'attendance_days', target: 3, amountCents: 3000 }, facts).qualified).toBe(false);
  });

  it('counts the technician\'s in-period memberships for membership_count', async () => {
    const facts = await loader({ tenantId: T, branchId: null } as any, TECH1, '2026-01-01', '2026-01-31');
    expect(facts.membershipCount).toBe(2); // two in Jan for TECH1; not the Nov one nor TECH2's
    expect(evaluateBonus({ metric: 'membership_count', target: 2, amountCents: 4000, label: 'Membership drive' }, facts).qualified).toBe(true);
    expect(evaluateBonus({ metric: 'membership_count', target: 3, amountCents: 4000 }, facts).qualified).toBe(false);
  });
});
