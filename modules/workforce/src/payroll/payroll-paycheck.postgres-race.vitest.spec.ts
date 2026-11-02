// payroll-paycheck.postgres-race — REAL Postgres (PG_RACE_URL opt-in, our convention), Weekly Paycheck mandate §17 / §20:
// the money steps under true concurrency (a pool of 30 connections, row locks, the real outbox):
//   10 simultaneous submits → one submission + one event · 10 simultaneous owner approvals → one approval, exactly one
//   payout per instruction · 10 simultaneous issues of the same check → one issue + one event · 10 simultaneous cash
//   acknowledgments → one + one event · the statement / week paid exactly once.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { permissionsFor } from '@aipowersalon/permissions';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService } from './payroll-paycheck.service';

const url = process.env.PG_RACE_URL;
// a fresh salon per run: approved statements are immutable (the DB refuses their DELETE), so a run never cleans up history
const RUN = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
const U = (n: number) => `e1a8${RUN}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), OWNER = U(3), MGR = U(4), TECH = U(5), PERIOD = U(6);
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const manager = () => ({ tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }) as any;
let db: Kysely<any>; let pool: pg.Pool; let svc: PayrollPaycheckService;
const rows = async (s: any) => (await s.execute(db)).rows as any[];
const eventsOf = async (type: string) => Number((await rows(sql`select count(*)::int c from outbox_events where tenant_id = ${T} and event_type = ${type}`))[0].c);

describe.skipIf(!url)('weekly paycheck — money steps under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values (${T}, 'Race LLC', 'Race', ${'pay-race-' + RUN}, ${'PR' + RUN}, 'active', ${OWNER}) on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Lan', 'Vo', 'Lan Vo', 'active', true) on conflict (id) do nothing`.execute(db);
    await sql`insert into payroll_periods (id, tenant_id, label, period_start, period_end, status) values (${PERIOD}, ${T}, 'Race week', '2026-10-12', '2026-10-18', 'draft')`.execute(db);
    await sql`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values (${T}, ${PERIOD}, ${TECH}, 100001, 100001, 100001)`.execute(db);
    const outbox = new OutboxWriter();
    const wf = new PayrollWorkflowService(db as any, { outbox });
    svc = new PayrollPaycheckService(db as any, { workflow: wf, outbox });
    wf.paychecks = svc;
    await svc.calculate(manager(), PERIOD);
  }, 120_000);
  afterAll(async () => { if (db) await db.destroy(); });

  it('10 simultaneous submits → one submission, one event', async () => {
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => svc.submit(manager(), PERIOD)));
    expect(rs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const r of rs) if (r.status === 'rejected') expect((r.reason as any).code).toBe('PAYROLL_VERSION_CONFLICT');   // a loser is told, never half-done
    expect(await eventsOf('payroll.submitted_to_owner')).toBe(1);
  });

  it('10 simultaneous approvals → one approval, one payout per instruction', async () => {
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => svc.approve(owner(), PERIOD)));
    expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await eventsOf('payroll.period_finalized')).toBe(1);
    const pos = await rows(sql`select method, amount_cents from payroll_payouts where period_id = ${PERIOD} order by method`);
    expect(pos.map((p) => [p.method, Number(p.amount_cents)])).toEqual([['cash', 50000], ['check', 50001]]);
  });

  it('10 simultaneous issues of the same check → one issue; 10 cash acknowledgments → one; the week paid once', async () => {
    const [check] = await rows(sql`select id from payroll_payouts where period_id = ${PERIOD} and method = 'check'`);
    const [cash] = await rows(sql`select id from payroll_payouts where period_id = ${PERIOD} and method = 'cash'`);
    await Promise.allSettled(Array.from({ length: 10 }, () => svc.issueCheck(manager(), check.id, { checkNumber: '7001' })));
    expect(await eventsOf('payout.check_issued')).toBe(1);
    await svc.deliverCheck(manager(), check.id);
    await svc.prepareCash(manager(), cash.id, { cashSource: 'safe' });
    await Promise.allSettled(Array.from({ length: 10 }, () => svc.acknowledgeCashByTechnician({ tenantId: T, userId: U(50), role: 'TECHNICIAN', permissions: [] } as any, TECH, cash.id)));
    expect(await eventsOf('payout.cash_acknowledged')).toBe(1);
    const s = (await rows(sql`select status, paid_cents from payroll_statements where period_id = ${PERIOD}`))[0];
    expect(s).toMatchObject({ status: 'paid' });
    expect(Number(s.paid_cents)).toBe(100001);
    expect(await eventsOf('payroll.period_paid')).toBe(1);
  });
});
