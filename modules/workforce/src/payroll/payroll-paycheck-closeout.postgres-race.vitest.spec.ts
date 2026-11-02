// payroll-paycheck-closeout.postgres-race — REAL Postgres (PG_RACE_URL opt-in), the Weekly Paycheck close-out (Oct 27 2026)
// where money moves concurrently: 10 simultaneous QR-token confirmations of one cash payout → one confirmation, one event,
// paid once; 10 simultaneous manager + technician dual confirmations → one; 10 simultaneous cancels of a draft period →
// one cancel, one event, its statements voided once; 10 simultaneous "open last period" on a monthly salon → ONE period
// (the schedule-generated unique index, now ignoring canceled rows) and, after a cancel, a fresh one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { permissionsFor } from '@aipowersalon/permissions';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService } from './payroll-paycheck.service';

const url = process.env.PG_RACE_URL;
const RUN = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
const U = (n: number) => `c10e${RUN}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), OWNER = U(3), MGR = U(4), TECH = U(5), TECH2 = U(6), PERIOD = U(7), TECH_USER = U(8);
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const manager = () => ({ tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }) as any;
const techCtx = () => ({ tenantId: T, userId: TECH_USER, role: 'TECHNICIAN', permissions: [] }) as any;
let db: Kysely<any>; let pool: pg.Pool; let svc: PayrollPaycheckService;
const rows = async (s: any) => (await s.execute(db)).rows as any[];
const eventsOf = async (type: string) => Number((await rows(sql`select count(*)::int c from outbox_events where tenant_id = ${T} and event_type = ${type}`))[0].c);

describe.skipIf(!url)('weekly paycheck close-out — the new money steps under real concurrency', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values (${T}, 'Closeout Race LLC', 'Closeout Race', ${'pay-close-' + RUN}, ${'PC' + RUN}, 'active', ${OWNER}) on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Lan', 'Vo', 'Lan Vo', 'active', true), (${TECH2}, ${T}, ${B}, 'Kim', 'Le', 'Kim Le', 'active', true) on conflict (id) do nothing`.execute(db);
    await sql`insert into payroll_periods (id, tenant_id, label, period_start, period_end, status) values (${PERIOD}, ${T}, 'Close-out race week', '2026-10-12', '2026-10-18', 'draft')`.execute(db);
    await sql`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values (${T}, ${PERIOD}, ${TECH}, 100000, 100000, 100000), (${T}, ${PERIOD}, ${TECH2}, 60000, 60000, 60000)`.execute(db);
    const outbox = new OutboxWriter();
    const wf = new PayrollWorkflowService(db as any, { outbox });
    svc = new PayrollPaycheckService(db as any, { workflow: wf, outbox, pins: { verifyPin: async (_c, techId, pin) => ({ ok: techId === TECH2 && pin === '2468' }) } });
    wf.paychecks = svc;
    await svc.calculate(manager(), PERIOD);
    await svc.submit(manager(), PERIOD);
    await svc.approve(owner(), PERIOD);
  }, 120_000);
  afterAll(async () => { if (db) await db.destroy(); });

  it('10 simultaneous QR-code confirmations → one confirmation, one event, the cash paid once', async () => {
    const [cash] = await rows(sql`select id from payroll_payouts where period_id = ${PERIOD} and technician_id = ${TECH} and method = 'cash'`);
    await svc.prepareCash(manager(), cash.id, { cashSource: 'safe' });
    const tok = await svc.issueHandoffToken(manager(), cash.id);
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => svc.acknowledgeCashByTechnician(techCtx(), TECH, cash.id, { handoffCode: tok.handoffCode })));
    // every caller is answered with the confirmed payout (a loser of the row lock sees it already acknowledged, or the token already consumed)
    for (const r of rs) if (r.status === 'rejected') expect((r.reason as any).code).toBe('HANDOFF_TOKEN_INVALID');
    expect(rs.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await eventsOf('payout.cash_acknowledged')).toBe(1);
    const x = (await rows(sql`select status, cash_status, cash_ack_method, cash_handoff_token_hash from payroll_payouts where id = ${cash.id}`))[0];
    expect(x).toMatchObject({ status: 'paid', cash_status: 'acknowledged', cash_ack_method: 'qr_handoff', cash_handoff_token_hash: null });
    const s = (await rows(sql`select status, paid_cents from payroll_statements where period_id = ${PERIOD} and technician_id = ${TECH}`))[0];
    expect(Number(s.paid_cents)).toBe(50000);
    expect(s.status).toBe('partially_paid');
  });

  it('10 simultaneous manager + technician dual confirmations → one; paid + unpaid = payable', async () => {
    const [cash] = await rows(sql`select id from payroll_payouts where period_id = ${PERIOD} and technician_id = ${TECH2} and method = 'cash'`);
    await svc.prepareCash(manager(), cash.id, { cashSource: 'bank_withdrawal' });
    await svc.handOffCash(manager(), cash.id);
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => svc.acknowledgeCashDual(manager(), cash.id, { pin: '2468', deviceId: 'pos-race' })));
    expect(rs.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await eventsOf('payout.cash_acknowledged')).toBe(2);
    expect((await rows(sql`select cash_ack_method, cash_ack_confirmed_by from payroll_payouts where id = ${cash.id}`))[0]).toMatchObject({ cash_ack_method: 'manager_dual', cash_ack_confirmed_by: MGR });
    const s = (await rows(sql`select approved_payable_cents, paid_cents from payroll_statements where period_id = ${PERIOD} and technician_id = ${TECH2}`))[0];
    expect(Number(s.paid_cents)).toBe(30000);
    expect(Number(s.paid_cents) + (Number(s.approved_payable_cents) - Number(s.paid_cents))).toBe(60000);
    const prep = await svc.preparation(manager(), PERIOD);
    expect(prep.totals.reconciles).toBe(true);
    expect(prep.totals.paidCents).toBe(80000);
  });

  it('10 simultaneous "open last period" on a monthly salon → one period; 10 simultaneous cancels → one cancel; then a fresh period', async () => {
    await svc.saveSchedule(owner(), { frequency: 'monthly', autoPrepare: true });
    const opened = await Promise.allSettled(Array.from({ length: 10 }, () => svc.openWeek(manager())));
    const ok = opened.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map((r) => r.value);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of opened) if (r.status === 'rejected') expect((r.reason as any).code).toBe('PAYROLL_PERIOD_OVERLAP');   // a loser of the advisory lock sees the winner's period
    const ids = new Set(ok.map((r) => r.periodId));
    expect(ids.size).toBe(1);
    expect(ok.filter((r) => r.created)).toHaveLength(1);
    const monthId = ok[0].periodId;
    expect(Number((await rows(sql`select count(*)::int c from payroll_periods where tenant_id = ${T} and schedule_generated and status <> 'canceled'`))[0].c)).toBe(1);
    const canceled = await Promise.allSettled(Array.from({ length: 10 }, () => svc.cancelPeriod(manager(), monthId, { reason: 'race cancel' })));
    expect(canceled.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await eventsOf('payroll.period_canceled')).toBe(1);
    expect((await rows(sql`select status from payroll_periods where id = ${monthId}`))[0].status).toBe('canceled');
    const fresh = await svc.openWeek(manager());
    expect(fresh.created).toBe(true);
    expect(fresh.periodId).not.toBe(monthId);
    await svc.cancelPeriod(manager(), fresh.periodId, { reason: 'race cleanup' });
    await svc.saveSchedule(owner(), { frequency: 'weekly', autoPrepare: false });
  });
});
