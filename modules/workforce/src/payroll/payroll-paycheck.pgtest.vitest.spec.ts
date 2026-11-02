// payroll-paycheck.pgtest — Weekly Paycheck mandate (Oct 21 2026) §20 on the REAL schema (PGlite, every migration incl.
// 673): the whole week end to end through the ONE payroll — statements from payroll lines, the 50 / 50 default plan, a
// manual split, submit ×10 = one submission, separation of duties, owner approve with a hold, approve ×N = one set of
// payouts, the immutability trigger, check issue retry / deliver / void + replacement, cash from the drawer (insufficient
// refused; a retried prepare = one withdrawal), PIN and app acknowledgment (retry = one), dispute, cancel (never paid),
// partially paid → paid, the week paid, held statement approved later, technician privacy, tenant isolation, reports.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';
import { DOMAIN_EVENTS as E } from '@aipowersalon/events';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService, type PayrollCashDrawerPort } from './payroll-paycheck.service';

const U = (n: number) => `e1a70000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), T2 = U(2), B = U(3), B2 = U(4), OWNER = U(5), MGR = U(6), DELEGATE = U(7), DELEGATE_TECH = U(8), OTHER_OWNER = U(9);
const MIA = U(20), LEO = U(21), ANA = U(22), DEL_TECH = U(23), MIA_USER = U(30);
const PERIOD = U(40);
let pg: any; let db: any; let wf: PayrollWorkflowService; let svc: PayrollPaycheckService;
const events: string[] = [];
let drawerCash = 50_000;
const withdrawals = new Map<string, { id: string; amount: number }>();
const drawer: PayrollCashDrawerPort = {
  async availableCents() { return drawerCash; },
  async withdraw(_trx, _ctx, x) {
    const ex = withdrawals.get(x.idempotencyKey); if (ex) return { movementId: ex.id };
    const id = U(900 + withdrawals.size); withdrawals.set(x.idempotencyKey, { id, amount: x.amountCents }); drawerCash -= x.amountCents; return { movementId: id };
  },
  async reverse(_trx, _ctx, movementId) { for (const w of withdrawals.values()) if (w.id === movementId) drawerCash += w.amount; },
};
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const manager = () => ({ tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }) as any;
const delegate = (userId = DELEGATE) => ({ tenantId: T, branchId: B, userId, role: 'CUSTOM', permissions: [...permissionsFor('MANAGER'), 'payroll.approve'] as string[] }) as any;
const otherSalon = () => ({ tenantId: T2, branchId: B2, userId: OTHER_OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const reception = () => ({ tenantId: T, branchId: B, userId: U(10), role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') as string[] }) as any;
const stmtOf = async (tech: string) => (await q(`select * from payroll_statements where period_id = $1 and technician_id = $2 and status <> 'voided'`, [PERIOD, tech]))[0];
const payoutsOf = async (tech: string) => q(`select * from payroll_payouts where period_id = $1 and technician_id = $2 order by created_at, id`, [PERIOD, tech]);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [id, slug, code, ownerId] of [[T, 'pay-week', 'PAYW01', OWNER], [T2, 'pay-other', 'PAYW02', OTHER_OWNER]]) {
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values ($1,$2,$2,$3,$4,'active',$5)`, [id, `Salon ${code}`, slug, code, ownerId]);
  }
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  for (const [id, name, user] of [[MIA, 'Mia Chen', MIA_USER], [LEO, 'Leo Tran', null], [ANA, 'Ana Ruiz', null], [DEL_TECH, 'Dee Lim', DELEGATE_TECH]] as const) {
    if (user) await q(`insert into users (id, email, full_name, status) values ($1,$2,$3,'active') on conflict do nothing`, [user, `${user}@x.test`, name]).catch(() => undefined);
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active${user ? ', user_id' : ''}) values ($1,$2,$3,$4,$5,$6,'active',true${user ? ',$7' : ''})`,
      user ? [id, T, B, name.split(' ')[0], name.split(' ')[1], name, user] : [id, T, B, name.split(' ')[0], name.split(' ')[1], name]);
  }
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,null,'Week of Oct 12','2026-10-12','2026-10-18','draft')`, [PERIOD, T]);
  // Mia: $1,500.00 payable (with $40 cash tips); Leo: $1,000.01 (the odd cent); Ana: $500; Dee (the delegate's own line): $300
  const line = (tech: string, payable: number, cashTip = 0) => q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, tips_cents, cash_tip_cents, net_cents, payable_cents) values ($1,$2,$3,$4,$5,$5,$6,$6)`,
    [T, PERIOD, tech, payable - cashTip, cashTip, payable]);
  await line(MIA, 150_000, 4_000); await line(LEO, 100_001); await line(ANA, 50_000); await line(DEL_TECH, 30_000);
  const outbox = { write: async (_t: unknown, e: { eventType: string }) => { events.push(e.eventType); } } as any;
  wf = new PayrollWorkflowService(db, { outbox });
  svc = new PayrollPaycheckService(db, { workflow: wf, outbox, pins: { verifyPin: async (_c, techId, pin) => ({ ok: techId === MIA && pin === '4321' }) } });
  svc.cashDrawer = drawer;
  wf.paychecks = svc;
}, 240_000);

describe('weekly paycheck — the one payroll, end to end', () => {
  it('calculate makes one immutable-numbered statement per technician with the 50 / 50 default (odd cent → check)', async () => {
    const view = await svc.calculate(manager(), PERIOD);
    expect(view.statements).toHaveLength(4);
    const leo = view.statements.find((s) => s.technicianId === LEO)!;
    expect(leo.statementNumber).toMatch(/^PAY-2026-\d{6}$/);
    expect(leo.plan!.instructions.map((i) => [i.method, i.amountCents])).toEqual([['check', 50_001], ['cash', 50_000]]);
    expect(view.totals.payableCents).toBe(330_001);
    expect(view.totals.checkCents + view.totals.cashCents).toBe(330_001);
    const numbers = view.statements.map((s) => s.statementNumber);
    expect(new Set(numbers).size).toBe(4);
    // recalculating keeps the numbers (no new statements, no new numbers)
    const again = await svc.calculate(manager(), PERIOD);
    expect(again.statements.map((s) => s.statementNumber).sort()).toEqual([...numbers].sort());
  });

  it('a manual dollar split must equal the payable; a split that differs from the default needs a reason', async () => {
    const ana = await stmtOf(ANA);
    await expect(svc.setPayoutPlan(manager(), ana.id, { policyType: 'manual_amount', entries: [{ method: 'check', amountCents: 30_000 }, { method: 'cash', amountCents: 19_999 }], overrideReason: 'asked' }))
      .rejects.toMatchObject({ code: 'PAYOUT_PLAN_INVALID' });
    await expect(svc.setPayoutPlan(manager(), ana.id, { policyType: 'manual_amount', entries: [{ method: 'check', amountCents: 30_000 }, { method: 'cash', amountCents: 20_000 }] }))
      .rejects.toMatchObject({ code: 'PAYOUT_PLAN_INVALID' });   // no reason
    const s = await svc.setPayoutPlan(manager(), ana.id, { policyType: 'manual_amount', entries: [{ method: 'check', amountCents: 30_000 }, { method: 'cash', amountCents: 20_000 }], overrideReason: 'Ana asked for more on the check' });
    expect(s.plan!.differsFromDefault).toBe(true);
    expect(s.plan!.instructions.filter((i) => i.status === 'planned').map((i) => i.amountCents)).toEqual([30_000, 20_000]);
  });

  it('a receptionist cannot see or change payroll; another salon cannot see this one', async () => {
    await expect(svc.periodStatements(reception(), PERIOD)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.periodStatements(otherSalon(), PERIOD)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_FOUND' });
    await expect(svc.statement(otherSalon(), (await stmtOf(MIA)).id)).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
  });

  it('the owner cannot approve before the manager submits; submit ×10 = one submission', async () => {
    await expect(svc.approve(owner(), PERIOD)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY' });
    const before = events.filter((e) => e === E.PAYROLL_SUBMITTED_TO_OWNER).length;
    const first = await svc.submit(manager(), PERIOD);
    expect(first.alreadySubmitted).toBe(false);
    for (let i = 0; i < 9; i++) expect((await svc.submit(manager(), PERIOD)).alreadySubmitted).toBe(true);
    expect(events.filter((e) => e === E.PAYROLL_SUBMITTED_TO_OWNER).length - before).toBe(1);
    const p = (await q(`select status, submitted_by from payroll_periods where id = $1`, [PERIOD]))[0];
    expect(p).toMatchObject({ status: 'review', submitted_by: MGR });
    expect((await q(`select count(*)::int c from payroll_statements where period_id = $1 and status = 'submitted'`, [PERIOD]))[0].c).toBe(4);
  });

  it('deep-scan: an EMPTY week nobody submitted is never approved (it used to be finalized empty)', async () => {
    const empty = (await q(`insert into payroll_periods (tenant_id, label, period_start, period_end, status) values ($1, 'Empty week', '2030-01-07', '2030-01-13', 'draft') returning id`, [T]))[0].id;
    await expect(svc.approve(owner(), empty)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY' });
    expect((await q(`select status from payroll_periods where id = $1`, [empty]))[0].status).toBe('draft');
  });

  it('separation of duties: an approver paid on this payroll, or who submitted it, is refused', async () => {
    await expect(svc.approve(delegate(DELEGATE_TECH), PERIOD)).rejects.toMatchObject({ code: 'PAYROLL_SELF_APPROVAL' });
    await expect(svc.approve(manager(), PERIOD)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });   // a manager does not approve
    expect((await q(`select status from payroll_periods where id = $1`, [PERIOD]))[0].status).toBe('review');   // nothing changed
  });

  it('the owner returns it with a note; the manager resubmits; the owner approves holding Ana; approve ×N = one set of payouts', async () => {
    await expect(svc.decide(owner(), PERIOD, 'returned', { note: '' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await svc.decide(owner(), PERIOD, 'returned', { note: 'Check Leo\'s bonus' });
    expect((await q(`select status, owner_decision, owner_note from payroll_periods where id = $1`, [PERIOD]))[0]).toMatchObject({ status: 'draft', owner_decision: 'returned', owner_note: 'Check Leo\'s bonus' });
    expect((await stmtOf(LEO)).status).toBe('draft');
    await svc.submit(manager(), PERIOD);
    // PGlite is ONE session (simultaneous transactions would share it), so repeats run in sequence here; the 10-way race
    // on real Postgres is payroll-paycheck.postgres-race.vitest.spec.ts
    for (let i = 0; i < 5; i++) await svc.approve(owner(), PERIOD, { holdTechnicianIds: [ANA] });   // every repeat answers with the approved week
    expect((await q(`select status, owner_decision from payroll_periods where id = $1`, [PERIOD]))[0]).toMatchObject({ status: 'finalized', owner_decision: 'approved' });
    expect((await stmtOf(MIA)).status).toBe('locked');
    expect((await stmtOf(ANA)).status).toBe('held');
    expect(await payoutsOf(MIA)).toHaveLength(2);
    expect(await payoutsOf(ANA)).toHaveLength(0);
    expect((await q(`select payout_status from payroll_periods where id = $1`, [PERIOD]))[0].payout_status).toBe('unpaid');
  });

  it('an approved statement is immutable in the database (figures and delete refused)', async () => {
    const mia = await stmtOf(MIA);
    await expect(q(`update payroll_statements set approved_payable_cents = 1 where id = $1`, [mia.id])).rejects.toThrow();
    await expect(q(`delete from payroll_statements where id = $1`, [mia.id])).rejects.toThrow();
  });

  it('the older "mark everything paid" refuses — this week is paid through its checks and cash', async () => {
    await expect(wf.markPaid(owner(), PERIOD, { method: 'other' } as any)).rejects.toMatchObject({ code: 'PAYROLL_PAY_THROUGH_PAYOUTS' });
  });

  it('check: issue (retry = one), a duplicate number refused, delivered = paid → the statement is PARTIALLY PAID', async () => {
    const [check] = (await payoutsOf(MIA)).filter((x) => x.method === 'check');
    expect(check.amount_cents).toBe(75_000);
    await svc.issueCheck(manager(), check.id, { checkNumber: '1001' });
    await svc.issueCheck(manager(), check.id, { checkNumber: '1001' });   // retry
    expect(events.filter((e) => e === E.PAYOUT_CHECK_ISSUED)).toHaveLength(1);
    const [leoCheck] = (await payoutsOf(LEO)).filter((x) => x.method === 'check');
    await expect(svc.issueCheck(manager(), leoCheck.id, { checkNumber: '1001' })).rejects.toMatchObject({ code: 'CHECK_NUMBER_IN_USE' });
    await svc.deliverCheck(manager(), check.id);
    const s = await stmtOf(MIA);
    expect(s.status).toBe('partially_paid');
    expect(Number(s.paid_cents)).toBe(75_000);
    expect((await q(`select payout_status from payroll_periods where id = $1`, [PERIOD]))[0].payout_status).toBe('partially_paid');
  });

  it('cash: insufficient drawer refused; prepare retry = one withdrawal; prepared is NOT paid; PIN acknowledgment pays it', async () => {
    const [cash] = (await payoutsOf(MIA)).filter((x) => x.method === 'cash');
    drawerCash = 10_000;
    await expect(svc.prepareCash(manager(), cash.id, { cashSource: 'register_drawer', registerId: 'main', branchId: B })).rejects.toMatchObject({ code: 'INSUFFICIENT_CASH' });
    drawerCash = 200_000;
    await svc.prepareCash(manager(), cash.id, { cashSource: 'register_drawer', registerId: 'main', branchId: B });
    await svc.prepareCash(manager(), cash.id, { cashSource: 'register_drawer', registerId: 'main', branchId: B });
    expect(withdrawals.size).toBe(1);
    expect(drawerCash).toBe(125_000);
    expect((await stmtOf(MIA)).status).toBe('partially_paid');   // prepared cash is not paid
    await expect(svc.acknowledgeCashByPin(manager(), cash.id, { pin: '0000' })).rejects.toMatchObject({ code: 'PIN_INVALID' });
    await svc.acknowledgeCashByPin(manager(), cash.id, { pin: '4321' });
    await svc.acknowledgeCashByPin(manager(), cash.id, { pin: '4321' });   // retry
    expect(events.filter((e) => e === E.PAYOUT_CASH_ACKNOWLEDGED)).toHaveLength(1);
    const s = await stmtOf(MIA);
    expect(s.status).toBe('paid');
    expect(Number(s.paid_cents)).toBe(150_000);
  });

  it('cash: handed off → disputed by the technician → canceled is never paid and goes back in the drawer; re-planned by check', async () => {
    const [cash] = (await payoutsOf(LEO)).filter((x) => x.method === 'cash');
    await svc.prepareCash(manager(), cash.id, { cashSource: 'register_drawer', registerId: 'main', branchId: B });
    const afterPrep = drawerCash;
    await svc.handOffCash(manager(), cash.id);
    await expect(svc.disputeCash({ ...manager(), userId: U(99) }, MIA, cash.id, { reason: 'not mine' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });   // another technician
    await svc.disputeCash({ tenantId: T, userId: U(98), role: 'TECHNICIAN', permissions: [] } as any, LEO, cash.id, { reason: 'Envelope was $20 short' });
    await svc.resolveCash(manager(), cash.id, { action: 'cancel', reason: 'Recount; pay by check instead' });
    expect(drawerCash).toBe(afterPrep + 50_000);
    const x = (await q(`select status, cash_status from payroll_payouts where id = $1`, [cash.id]))[0];
    expect(x).toMatchObject({ status: 'canceled', cash_status: 'canceled' });
    const leo = await stmtOf(LEO);
    expect(Number(leo.paid_cents)).toBe(0);
    const add = await svc.addPayout(manager(), leo.id, { method: 'check' });
    expect(add.amountCents).toBe(50_000);
    await expect(svc.addPayout(manager(), leo.id, { method: 'check' })).rejects.toMatchObject({ code: 'PAYOUT_EXCEEDS_PAYABLE' });   // nothing left to plan
  });

  it('check void + replacement: the original stays in history, the replacement references it', async () => {
    const [leoCheck] = (await payoutsOf(LEO)).filter((x) => x.method === 'check' && x.check_status === 'planned');
    await svc.issueCheck(manager(), leoCheck.id, { checkNumber: '1002' });
    const r = await svc.voidCheck(manager(), leoCheck.id, { reason: 'Misprinted amount', replacementCheckNumber: '1003' });
    expect(r.voided.checkStatus).toBe('voided');
    expect(r.replacement).toMatchObject({ checkNumber: '1003', checkStatus: 'issued', replacesPayoutId: leoCheck.id, amountCents: 50_001 });
  });

  it('every payout complete → statement PAID and, once the held statement is approved and paid, the WEEK is paid', async () => {
    for (const x of (await payoutsOf(LEO)).filter((p) => p.method === 'check' && p.status === 'pending')) {
      if (x.check_status === 'planned') await svc.issueCheck(manager(), x.id, { checkNumber: `20${x.id.slice(-2)}` });
      await svc.deliverCheck(manager(), x.id);
    }
    expect((await stmtOf(LEO)).status).toBe('paid');
    for (const x of (await payoutsOf(DEL_TECH))) {
      if (x.method === 'check') { await svc.issueCheck(manager(), x.id, { checkNumber: `30${x.id.slice(-2)}` }); await svc.deliverCheck(manager(), x.id); }
      else { await svc.prepareCash(manager(), x.id, { cashSource: 'safe' }); await svc.acknowledgeCashByTechnician({ tenantId: T, userId: DELEGATE_TECH, role: 'TECHNICIAN', permissions: [] } as any, DEL_TECH, x.id); }
    }
    expect((await q(`select status, payout_status from payroll_periods where id = $1`, [PERIOD]))[0]).toMatchObject({ status: 'finalized', payout_status: 'partially_paid' });   // Ana is held
    await svc.approveHeld(owner(), (await stmtOf(ANA)).id);
    const ana = await payoutsOf(ANA);
    expect(ana.map((x) => x.amount_cents).sort()).toEqual([20_000, 30_000]);   // her manual split
    for (const x of ana) {
      if (x.method === 'check') { await svc.issueCheck(manager(), x.id, { checkNumber: '4001' }); await svc.deliverCheck(manager(), x.id); }
      else { await svc.prepareCash(manager(), x.id, { cashSource: 'bank_withdrawal' }); await svc.handOffCash(manager(), x.id); await svc.acknowledgeCashByTechnician({ tenantId: T, userId: U(97), role: 'TECHNICIAN', permissions: [] } as any, ANA, x.id); }
    }
    expect((await q(`select status, payout_status from payroll_periods where id = $1`, [PERIOD]))[0]).toMatchObject({ status: 'paid', payout_status: 'paid' });
    expect(events).toContain(E.PAYROLL_PERIOD_PAID);
  });

  it('Oct 28 decisions: a later void of a delivered check takes the PAID week back to finalized / partially paid; paying it again re-pays the week — and each technician paid in full is pushed once, without an amount', async () => {
    const pushed: Array<{ user: string; msg: any }> = [];
    (svc as any).opts.push = { dispatchToUser: async (_t: string, user: string, msg: any) => { pushed.push({ user, msg }); } };
    try {
      const anaCheck = (await payoutsOf(ANA)).find((x) => x.method === 'check' && x.status === 'paid')!;
      await svc.voidCheck(manager(), anaCheck.id, { reason: 'Returned by the bank' });
      expect((await stmtOf(ANA)).status).toBe('partially_paid');
      expect((await q(`select status, payout_status, paid_at from payroll_periods where id = $1`, [PERIOD]))[0]).toMatchObject({ status: 'finalized', payout_status: 'partially_paid', paid_at: null });
      expect(pushed).toEqual([]);   // nothing became paid
      // the remainder is planned again and paid → the statement and the week are paid again, Ana is told once
      const again = await svc.addPayout(manager(), (await stmtOf(ANA)).id, { method: 'check' });
      await svc.issueCheck(manager(), again.id, { checkNumber: '4002' });
      await svc.deliverCheck(manager(), again.id);
      expect((await q(`select status, payout_status from payroll_periods where id = $1`, [PERIOD]))[0]).toMatchObject({ status: 'paid', payout_status: 'paid' });
      const done = pushed.filter((x) => x.msg?.data?.kind === 'payroll_payout_completed');
      expect(done).toHaveLength(1);
      expect(done[0].user).toBe(U(97));
      expect(JSON.stringify(done[0].msg)).not.toMatch(/\$|\d{3,}\.\d{2}/);   // no amount in the push
    } finally { (svc as any).opts.push = null; }
  });

  it('a technician sees only their own statements, never the manager note, never another technician', async () => {
    await q(`update payroll_statements set manager_note = 'private' where technician_id = $1 and period_id = $2`, [MIA, PERIOD]).catch(() => undefined);
    const mine = await svc.myPayroll({ tenantId: T, userId: MIA_USER } as any, MIA);
    expect(mine.statements.every((s) => s.periodId === PERIOD)).toBe(true);
    expect(mine.statements).toHaveLength(1);
    const st = await svc.myStatement({ tenantId: T, userId: MIA_USER } as any, MIA, (await stmtOf(MIA)).id);
    expect(st).not.toHaveProperty('managerNote');
    expect(st.paidCents).toBe(150_000);
    await expect(svc.myStatement({ tenantId: T, userId: MIA_USER } as any, MIA, (await stmtOf(LEO)).id)).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
  });

  it('reports: payroll expense counted once; check + cash + already-paid + unpaid reconcile to it', async () => {
    const r = await svc.report(owner(), { range: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(r.statements).toBe(4);
    expect(r.accounting.compensationExpenseCents).toBe(330_001);
    expect(r.accounting.reconciles).toBe(true);
    expect(r.byMethod.check.paidCents + r.byMethod.cash.paidCents).toBe(330_001);
    expect(r.checkRegister.some((c) => c.checkStatus === 'voided' && c.checkNumber === '1002')).toBe(true);
    expect(r.cashPayouts.some((c) => c.cashStatus === 'canceled')).toBe(true);
    const summary = await svc.ownerSummary(owner());
    expect(summary.unpaidCents).toBe(0);
  });
});

describe('weekly paycheck — the rest of the §20 security / concurrency matrix', () => {
  const P2 = U(41), B3 = U(42);
  beforeAll(async () => {
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Second','active','America/New_York')`, [B3, T]);
    await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,null,'Week of Oct 19','2026-10-19','2026-10-25','draft')`, [P2, T]);
    await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values ($1,$2,$3,10000,10000,10000)`, [T, P2, LEO]);
    await svc.calculate(manager(), P2);
  });
  it('a stale edit (the version the manager saw is old) is PAYROLL_VERSION_CONFLICT, never a silent overwrite', async () => {
    const st = (await q(`select id, version from payroll_statements where period_id = $1`, [P2]))[0];
    await svc.setPayoutPlan(manager(), st.id, { policyType: 'all_check', overrideReason: 'Leo prefers a check', expectedVersion: st.version });
    await expect(svc.setPayoutPlan(manager(), st.id, { policyType: 'all_cash', overrideReason: 'stale screen', expectedVersion: st.version })).rejects.toMatchObject({ code: 'PAYROLL_VERSION_CONFLICT' });
    const p = (await q(`select version from payroll_periods where id = $1`, [P2]))[0];
    await expect(svc.submit(manager(), P2, { expectedVersion: Number(p.version) - 1 })).rejects.toMatchObject({ code: 'PAYROLL_VERSION_CONFLICT' });
  });
  it('after submission the manager can no longer change a split (the owner reviews exactly what was submitted)', async () => {
    await svc.submit(manager(), P2);
    const st = (await q(`select id, version from payroll_statements where period_id = $1`, [P2]))[0];
    await expect(svc.setPayoutPlan(manager(), st.id, { policyType: 'all_cash', overrideReason: 'late change', expectedVersion: st.version })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY' });
  });
  it('a receptionist cannot change a split, submit, approve or pay out', async () => {
    const st = (await q(`select id from payroll_statements where period_id = $1`, [P2]))[0];
    await expect(svc.setPayoutPlan(reception(), st.id, { policyType: 'all_cash' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.submit(reception(), P2)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.approve(reception(), P2)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const [x] = await payoutsOf(MIA);
    await expect(svc.issueCheck(reception(), x.id, { checkNumber: '9999' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.prepareCash(reception(), x.id, { cashSource: 'safe' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
  it('someone who may only VIEW payroll at another branch sees none of this branch\'s technicians', async () => {
    const viewer = { tenantId: T, branchId: B3, userId: U(60), role: 'CUSTOM', permissions: ['payroll.view', 'pos.payroll.view'] } as any;
    const v = await svc.periodStatements(viewer, PERIOD);
    expect(v.statements).toHaveLength(0);
    await expect(svc.statement(viewer, (await stmtOf(MIA)).id)).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    const home = { ...viewer, branchId: B };
    expect((await svc.periodStatements(home, PERIOD)).statements.length).toBe(4);
  });
  it('the generic payout-status route cannot re-decide a paycheck payout (paid or not) — only its own lifecycle can', async () => {
    const paid = (await payoutsOf(MIA)).find((x) => x.status === 'paid')!;
    await expect(wf.setPayoutStatus(owner(), paid.id, { status: 'canceled' } as any)).rejects.toMatchObject({ code: 'PAYROLL_PAY_THROUGH_PAYOUTS' });
  });
  it('another salon can neither see nor pay out this salon\'s payouts', async () => {
    const [x] = await payoutsOf(MIA);
    await expect(svc.issueCheck(otherSalon(), x.id, { checkNumber: '5555' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(svc.payout(otherSalon(), x.id)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await svc.myPayroll({ tenantId: T2 } as any, MIA)).statements).toHaveLength(0);
  });
});

