// payroll-period-overlap.postgres-race — REAL Postgres (PG_RACE_URL): ten simultaneous "create this week" calls for one
// salon make exactly ONE period; the other nine are 409 PAYROLL_PERIOD_OVERLAP (the per-salon advisory lock serializes the
// overlap check). PGlite is one session, so only this lane can show it (deep-scan, Oct 22 2026).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { PayrollService } from './payroll.service';
import { KyselyPayrollRepository } from './payroll.kysely.repository';

const url = process.env.PG_RACE_URL;
const U = (n: number) => `d7b10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), OWNER = U(3);
const ctx = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.payroll.manage', 'pos.payroll.view'] } as any);
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('pay period overlap under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 20 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from payroll_periods where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Overlap LLC', 'Overlap', 'pay-ovl-race', 'PAYOVR', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from payroll_periods where tenant_id = ${T}`.execute(db).catch(() => undefined); await db.destroy(); });

  it('ten simultaneous creates of the same week → exactly one period; nine 409 PAYROLL_PERIOD_OVERLAP', async () => {
    const svc = new PayrollService(new KyselyPayrollRepository(db as any));
    // the gate: one connection holds the table, the ten callers pile up behind it, then it lets go all at once
    const gate = await pool.connect();
    await gate.query('BEGIN'); await gate.query('LOCK TABLE payroll_periods IN ACCESS EXCLUSIVE MODE');
    const calls = Array.from({ length: 10 }, () => svc.createPeriod(ctx(), { periodStart: '2026-11-09', periodEnd: '2026-11-15' }));
    await new Promise((r) => setTimeout(r, 600));
    await gate.query('COMMIT'); gate.release();
    const rs = await Promise.allSettled(calls);
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rs.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.code)).toEqual(Array(9).fill('PAYROLL_PERIOD_OVERLAP'));
    expect(Number((await sql<{ n: number }>`select count(*)::int as n from payroll_periods where tenant_id = ${T}`.execute(db)).rows[0].n)).toBe(1);
  });
});
