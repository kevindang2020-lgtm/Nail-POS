// payroll-paycheck-closeout.pgtest — the INTERNAL close-out of the Weekly Paycheck mandate (docs/mandates/status/
// WEEKLY_PAYCHECK_STATUS.md, Oct 27 2026) on the REAL schema (PGlite, every migration incl. 701):
//   §17.7 the manager's "payroll is ready for review" push after the period is opened + calculated (no amounts);
//   §14 / §20.3 a BRANCH-confined manager sees and changes only their branch's statements and cannot run the salon-wide steps;
//   §19.4 calculate writes its own audit row; §17.1 payroll.manager_review_started goes through the outbox;
//   §8.4 the hourly / time-clock evidence behind a statement; §12.4 the preparation report (checks / cash envelopes, reconciled);
//   §4.2 itemised reversals on the statement; §3.3 a monthly schedule opens its last completed month; §3.4 a draft period
//   opened by mistake is CANCELED (statements voided) and the slot is free again; §11.5 QR handoff token, PIN + signature
//   and manager + technician dual confirmation — each one confirmation, each paid, every cent still reconciling.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';
import { DOMAIN_EVENTS as E } from '@aipowersalon/events';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService } from './payroll-paycheck.service';

const U = (n: number) => `c10e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = U(1), B = U(2), B2 = U(3), OWNER = U(4), MGR = U(5), BM = U(6), REC = U(7);
const MIA = U(20), NOA = U(21), LEO = U(22), MIA_USER = U(30), NOA_USER = U(31), LEO_USER = U(32);
const PERIOD = U(40);
let pg: any; let db: any; let wf: PayrollWorkflowService; let svc: PayrollPaycheckService;
const events: Array<{ type: string; payload: any }> = [];
const audits: Array<{ action: string; resourceId: string; metadata: any; reason: string | null }> = [];
const pushes: Array<{ userId: string; title: string; body: string; kind: string }> = [];
let clock = new Date('2026-10-21T15:00:00Z');
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] }) as any;
const manager = () => ({ tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] }) as any;
/** a MANAGER whose role template confines them to the second branch (req.ctx.authz as the middleware builds it) */
const branchManager = () => ({ tenantId: T, branchId: B2, userId: BM, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
const reception = () => ({ tenantId: T, branchId: B, userId: REC, role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') as string[] }) as any;
const tech = (userId: string) => ({ tenantId: T, userId, role: 'TECHNICIAN', permissions: [] }) as any;
const stmtOf = async (techId: string, period = PERIOD) => (await q(`select * from payroll_statements where period_id = $1 and technician_id = $2 and status <> 'voided'`, [period, techId]))[0];
const payoutsOf = async (techId: string) => q(`select * from payroll_payouts where period_id = $1 and technician_id = $2 order by created_at, id`, [PERIOD, techId]);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values ($1,'Closeout Salon','Closeout Salon','closeout','CLOSE1','active',$2)`, [T, OWNER]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Second','active','America/New_York')`, [B, T, B2]);
  for (const [id, email, name, role] of [[OWNER, 'owner', 'Olga Owner', 'OWNER'], [MGR, 'mgr', 'Max Floor', 'MANAGER'], [BM, 'bm', 'Bea Branch', 'MANAGER'], [REC, 'rec', 'Rae Desk', 'FRONT_DESK'],
    [MIA_USER, 'mia', 'Mia Chen', 'TECHNICIAN'], [NOA_USER, 'noa', 'Noa Pham', 'TECHNICIAN'], [LEO_USER, 'leo', 'Leo Tran', 'TECHNICIAN']]) {
    await q(`insert into users (id, tenant_id, email, full_name, status, role) values ($1,$2,$3,$4,'active',$5)`, [id, T, `${email}@closeout.test`, name, role]);
  }
  for (const [id, branch, name, user] of [[MIA, B, 'Mia Chen', MIA_USER], [NOA, B2, 'Noa Pham', NOA_USER], [LEO, B, 'Leo Tran', LEO_USER]]) {
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, user_id) values ($1,$2,$3,$4,$5,$6,'active',true,$7)`, [id, T, branch, name.split(' ')[0], name.split(' ')[1], name, user]);
  }
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,null,'Week of Oct 12','2026-10-12','2026-10-18','draft')`, [PERIOD, T]);
  // Mia (Main): commission $200 + tips $50 + hourly $310 (15.5 paid hours at $20) − a $10 refund reversal − a $2 tip taken back = $548 net
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, tips_cents, card_tip_cents, hourly_pay_cents, worked_minutes, adjustment_cents, net_cents, payable_cents)
    values ($1,$2,$3,20000,5000,5000,31000,960,-1200,54800,54800)`, [T, PERIOD, MIA]);
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values ($1,$2,$3,10000,10000,10000)`, [T, PERIOD, NOA]);
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, commission_cents, net_cents, payable_cents) values ($1,$2,$3,8000,8000,8000)`, [T, PERIOD, LEO]);
  // the ledger entries behind Mia's −$12.00 (routed to the period) and a positive correction that is NOT a reversal
  for (const [cat, cents, src] of [['refund_reversal', -1000, 'refund'], ['tip_correction', -200, 'manual']] as const) {
    await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, period_id, category, amount_cents, status, reason, source) values ($1,$2,$3,$4,$5,$6,'posted','test',$7)`, [T, B, MIA, PERIOD, cat, cents, src]);
  }
  // Mia's time clock: an hourly plan ($20/h, breaks unpaid) and two completed punches with one 30-minute break
  await q(`insert into technician_pay_plans (tenant_id, technician_id, pay_type, hourly_rate_cents, breaks_paid, effective_start, status) values ($1,$2,'hybrid',2000,false,'2026-01-01','active')`, [T, MIA]);
  const s1 = (await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,'2026-10-13','2026-10-13T13:00:00Z','2026-10-13T21:00:00Z','completed') returning id`, [T, B, MIA]))[0].id;
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,'2026-10-14','2026-10-14T13:00:00Z','2026-10-14T21:00:00Z','completed')`, [T, B, MIA]);
  await q(`insert into technician_breaks (tenant_id, branch_id, technician_id, shift_id, kind, started_at, ended_at) values ($1,$2,$3,$4,'lunch','2026-10-13T17:00:00Z','2026-10-13T17:30:00Z')`, [T, B, MIA, s1]);
  await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values ($1,$2,$3,2,'09:00','17:00','13:00','13:30',true), ($1,$2,$3,3,'09:00','17:00',null,null,true)`, [T, B, MIA]);
  const outbox = { write: async (_t: unknown, e: { eventType: string; payload: any }) => { events.push({ type: e.eventType, payload: e.payload }); } } as any;
  const audit = { record: async (_a: unknown, e: { action: string; resourceId: string; metadata: any; reason: string | null }) => { audits.push({ action: e.action, resourceId: e.resourceId, metadata: e.metadata, reason: e.reason ?? null }); } } as any;
  const push = { dispatchToUser: async (_t: string | null, userId: string, msg: any) => { pushes.push({ userId, title: msg.title, body: msg.body ?? '', kind: msg.data?.kind ?? '' }); return { ok: true }; } };
  wf = new PayrollWorkflowService(db, { outbox, audit });
  svc = new PayrollPaycheckService(db, { workflow: wf, outbox, audit, push, now: () => clock, pins: { verifyPin: async (_c, techId, pin) => ({ ok: (techId === NOA && pin === '2222') || (techId === LEO && pin === '3333') }) } });
  wf.paychecks = svc;
}, 240_000);

describe('close-out §3.3 / §3.4 / §17.7 — a monthly schedule opens its last month, tells the manager, and a mistake is canceled', () => {
  let monthId = '';
  it('the scheduler path: a monthly salon opens Sep 1–30, calculated, and the manager is pushed "ready for review" without amounts', async () => {
    await svc.saveSchedule(owner(), { frequency: 'monthly', payDayOffsetDays: 5, autoPrepare: true });
    const before = pushes.length;
    const r = await svc.openWeek(manager());
    monthId = r.periodId;
    expect(r).toMatchObject({ created: true, periodStart: '2026-09-01', periodEnd: '2026-09-30', payDate: '2026-10-05', frequency: 'monthly' });
    expect((await q(`select label, status, schedule_generated from payroll_periods where id = $1`, [monthId]))[0]).toMatchObject({ label: 'Month of 2026-09-01 – 2026-09-30', status: 'draft', schedule_generated: true });
    const sent = pushes.slice(before).filter((p) => p.kind === 'payroll_ready_for_review');
    expect(sent.map((p) => p.userId).sort()).toEqual([BM, MGR].sort());   // every active manager of the salon, never the owner while one exists
    for (const p of sent) expect(`${p.title} ${p.body}`).not.toMatch(/\$|\d+\.\d{2}/);   // dates and a technician count, never money
    // §19.4 + §17.1: the calculation is audited and announced
    expect(audits.some((a) => a.action === 'period.calculated' && a.resourceId === monthId)).toBe(true);
    expect(events.some((e) => e.type === E.PAYROLL_MANAGER_REVIEW_STARTED && e.payload.periodId === monthId)).toBe(true);
    // opening again is the same period (idempotent), no second push
    const again = await svc.openWeek(manager());
    expect(again).toMatchObject({ periodId: monthId, created: false });
    expect(pushes.slice(before).filter((p) => p.kind === 'payroll_ready_for_review')).toHaveLength(sent.length);
  });
  it('a draft period opened by mistake is CANCELED (reason required, audited, event), and the same month can be opened again', async () => {
    await expect(svc.cancelPeriod(manager(), monthId, { reason: '' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.cancelPeriod(branchManager(), monthId, { reason: 'not mine to cancel' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    // Oct 27 final pass: the month has no earnings, so give it a draft statement to prove the voiding (it is kept, never deleted)
    const anyTech = (await q(`select id from technicians where tenant_id = $1 limit 1`, [T]))[0].id;
    await q(`insert into payroll_statements (tenant_id, period_id, technician_id, statement_number, status) values ($1, $2, $3, 'CANCEL-PROBE-1', 'draft')`, [T, monthId, anyTech]);
    const v = await svc.cancelPeriod(manager(), monthId, { reason: 'Opened by mistake — the salon pays weekly' });
    expect(v.period.status).toBe('canceled');
    expect(v.period.cancelReason).toBe('Opened by mistake — the salon pays weekly');
    expect((await q(`select status, canceled_by, cancel_reason from payroll_periods where id = $1`, [monthId]))[0]).toMatchObject({ status: 'canceled', canceled_by: MGR });
    expect(audits.some((a) => a.action === 'period.canceled' && a.resourceId === monthId)).toBe(true);
    const st = (await q(`select count(*)::int n, count(*) filter (where status = 'voided')::int v from payroll_statements where period_id = $1`, [monthId]))[0];
    expect(st).toEqual({ n: 1, v: 1 });   // statements voided, kept
    // its draft statements are voided, never deleted (Oct 27 final pass) — see the 'statements voided' assertion below
    expect(events.some((e) => e.type === E.PAYROLL_PERIOD_CANCELED && e.payload.periodId === monthId)).toBe(true);
    await expect(svc.calculate(manager(), monthId)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_LOCKED' });
    await expect(svc.submit(manager(), monthId)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_LOCKED' });
    expect((await svc.cancelPeriod(manager(), monthId, { reason: 'again' })).period.status).toBe('canceled');   // a repeat is a no-op
    // the canceled month holds no days: the worker opens a fresh one for the same month
    const fresh = await svc.openWeek(manager());
    expect(fresh.created).toBe(true);
    expect(fresh.periodId).not.toBe(monthId);
    await svc.cancelPeriod(manager(), fresh.periodId, { reason: 'test cleanup' });
    await svc.saveSchedule(owner(), { frequency: 'weekly', autoPrepare: false });
  });
});

describe('close-out §4.2 / §14 / §8.4 — the week: itemised reversals, the branch manager, the evidence', () => {
  it('calculate itemises Mia\'s reversals (refund $10, tip $2) inside the $12 reversal total, and audits itself', async () => {
    const view = await svc.calculate(manager(), PERIOD);
    expect(view.statements).toHaveLength(3);
    const mia = view.statements.find((s) => s.technicianId === MIA)!;
    expect(mia).toMatchObject({ reversalsCents: 1200, refundReversalCents: 1000, tipAdjustmentCents: 200, retailReversalCents: 0, approvedPayableCents: 54800 });
    expect(audits.filter((a) => a.action === 'period.calculated' && a.resourceId === PERIOD)).toHaveLength(1);
    expect(audits.find((a) => a.action === 'period.calculated' && a.resourceId === PERIOD)!.metadata).toMatchObject({ statements: 3 });
    expect(events.filter((e) => e.type === E.PAYROLL_MANAGER_REVIEW_STARTED && e.payload.periodId === PERIOD)).toHaveLength(1);
  });
  it('a branch-confined manager sees only the second branch\'s technician and cannot touch the first branch\'s split', async () => {
    const mine = await svc.periodStatements(branchManager(), PERIOD);
    expect(mine.statements.map((s) => s.technicianId)).toEqual([NOA]);
    expect(mine.period.branchScope).toBe(B2);
    expect(mine.totals.technicians).toBe(1);
    const miaId = (await stmtOf(MIA)).id, noaId = (await stmtOf(NOA)).id;
    await expect(svc.statement(branchManager(), miaId)).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    // the mutation (§20.3): branch B manager cannot change branch A's technician's split
    await expect(svc.setPayoutPlan(branchManager(), miaId, { policyType: 'all_cash', overrideReason: 'not my branch' })).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    expect((await svc.statement(manager(), miaId)).plan!.policyType).toBe('split_check_cash');   // untouched
    // their own branch's technician — allowed
    const noa = await svc.setPayoutPlan(branchManager(), noaId, { policyType: 'all_check', overrideReason: 'Noa asked for a check' });
    expect(noa.plan!.policyType).toBe('all_check');
    // the salon-wide steps are not theirs
    for (const [name, fn] of [['submit', () => svc.submit(branchManager(), PERIOD)], ['calculate', () => svc.calculate(branchManager(), PERIOD)], ['applyDefaultToAll', () => svc.applyDefaultToAll(branchManager(), PERIOD)], ['openWeek', () => svc.openWeek(branchManager())]] as const) {
      await expect(fn(), name).rejects.toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'branch_scoped' } });
    }
    expect((await q(`select status from payroll_periods where id = $1`, [PERIOD]))[0].status).toBe('draft');
    // the salon-wide manager sees everyone
    expect((await svc.periodStatements(manager(), PERIOD)).statements).toHaveLength(3);
  });
  it('the evidence behind Mia\'s hourly pay: two punches, one 30-minute unpaid break, $20/h → $310, equal to the line', async () => {
    const ev = await svc.technicianEvidence(manager(), PERIOD, MIA);
    expect(ev.hours.plan).toMatchObject({ payType: 'hybrid', hourlyRateCents: 2000, breaksPaid: false });
    expect(ev.hours.entries).toHaveLength(2);
    expect(ev.hours.entries[0]).toMatchObject({ shiftDate: '2026-10-13', open: false, workedMinutes: 480, breakMinutes: 30, paidMinutes: 450, scheduledMinutes: 450 });
    expect(ev.hours.entries[0].breaks).toHaveLength(1);
    expect(ev.hours.entries[1]).toMatchObject({ shiftDate: '2026-10-14', workedMinutes: 480, breakMinutes: 0, paidMinutes: 480, scheduledMinutes: 480 });
    expect(ev.hours.totals).toMatchObject({ workedMinutes: 960, breakMinutes: 30, paidMinutes: 930, scheduledMinutes: 930, computedHourlyPayCents: 31000, lineHourlyPayCents: 31000, matchesLine: true, potentialOvertimeMinutes: 0 });
    expect(ev.hours.openEntries).toBe(0);
    // the branch manager may open their own branch's technician, never the other branch's
    await expect(svc.technicianEvidence(branchManager(), PERIOD, MIA)).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    expect((await svc.technicianEvidence(branchManager(), PERIOD, NOA)).hours.entries).toEqual([]);
    await expect(svc.technicianEvidence(reception(), PERIOD, MIA)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('close-out §12.4 / §11.5 — the preparation report and the three more confirmations', () => {
  it('before approval there is nothing to prepare; a submitted week cannot be canceled; after approval the report reconciles', async () => {
    await expect(svc.preparation(manager(), PERIOD)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY' });
    await svc.submit(manager(), PERIOD);
    await expect(svc.cancelPeriod(manager(), PERIOD, { reason: 'too late' })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_READY' });
    await svc.approve(owner(), PERIOD);
    await expect(svc.preparation(reception(), PERIOD)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(svc.preparation({ ...manager(), permissions: ['pos.payroll.view', 'payroll.view'] }, PERIOD)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const r = await svc.preparation(manager(), PERIOD);
    expect(r.technicians).toBe(3);
    // Mia 50 / 50 of $548 → check $274 / cash $274; Noa all check $100; Leo 50 / 50 of $80 → $40 / $40
    expect(r.checks).toMatchObject({ count: 3, amountCents: 27400 + 10000 + 4000, toIssue: 3, toDeliver: 0, delivered: 0 });
    expect(r.cash).toMatchObject({ count: 2, amountCents: 27400 + 4000, toPrepare: 2, toHandOff: 0, toAcknowledge: 0, acknowledged: 0 });
    expect(r.cash.bySource).toEqual({ not_prepared: { count: 2, amountCents: 31400 } });
    expect(r.checks.lines.map((l) => l.technicianName)).toEqual(['Leo Tran', 'Mia Chen', 'Noa Pham']);   // by technician name
    expect(r.unplanned).toEqual([]);
    expect(r.totals).toEqual({ payableCents: 72800, committedCents: 72800, unplannedCents: 0, paidCents: 0, unpaidCents: 72800, reconciles: true });
    // the branch manager's report covers their branch only
    const b = await svc.preparation(branchManager(), PERIOD);
    expect(b.technicians).toBe(1);
    expect(b.totals).toMatchObject({ payableCents: 10000, committedCents: 10000, reconciles: true });
  });
  it('Oct 28 audit (§14.3 / §20.3 / §24.2): a branch manager cannot touch another branch\'s payouts, and sees only their branch in the report and summary', async () => {
    const [miaCash] = (await payoutsOf(MIA)).filter((x) => x.method === 'cash');
    const [leoCheck] = (await payoutsOf(LEO)).filter((x) => x.method === 'check');
    const miaStmt = await stmtOf(MIA);
    // the first branch's payouts answer exactly like missing ones — no prepare, no issue, no void, no extra payout
    await expect(svc.prepareCash(branchManager(), miaCash.id, { cashSource: 'safe' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(svc.issueCheck(branchManager(), leoCheck.id, { checkNumber: '9001' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(svc.voidCheck(branchManager(), leoCheck.id, { reason: 'not mine' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(svc.addPayout(branchManager(), String(miaStmt.id), { method: 'cash', amountCents: 1 })).rejects.toMatchObject({ code: 'STATEMENT_NOT_FOUND' });
    expect((await payoutsOf(MIA)).find((x) => x.id === miaCash.id)).toMatchObject({ cash_status: 'planned' });   // untouched
    // the report and the summary: Noa (second branch) only — no first-branch names or amounts
    const rep = await svc.report(branchManager(), { range: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(rep.byTechnician.map((t) => t.technicianName)).toEqual(['Noa Pham']);
    expect([...rep.checkRegister, ...rep.cashPayouts].every((x) => x.technicianName === 'Noa Pham')).toBe(true);
    expect(rep.totals.approvedPayableCents).toBe(10000);
    expect((await svc.ownerSummary(branchManager())).approvedPayableCents).toBe(10000);
    // a salon-wide manager is unchanged
    expect((await svc.report(manager(), { range: 'custom', from: '2026-10-01', to: '2026-10-31' })).totals.approvedPayableCents).toBe(72800);
  });
  it('Oct 28 re-audit (§14.3 / §24.2): the legacy period reads — detail, payouts, technician drill-down, adjustments — show a branch manager only their branch', async () => {
    const d = await wf.detail(branchManager(), PERIOD);
    expect(d.lines.map((l) => l.technicianId)).toEqual([NOA]);
    expect(d.payouts.every((x) => x.technicianId === NOA)).toBe(true);
    expect(d.totals.payableCents).toBe(10000);
    expect((await wf.payouts(branchManager(), PERIOD)).every((x) => x.technicianId === NOA)).toBe(true);
    await expect(wf.technicianDetail(branchManager(), PERIOD, MIA)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect((await wf.technicianDetail(branchManager(), PERIOD, NOA)).line?.technicianId).toBe(NOA);
    expect((await wf.listAdjustments(branchManager(), { periodId: PERIOD })).some((a) => a.technicianId === MIA)).toBe(false);
    // the salon-wide manager is unchanged
    expect((await wf.detail(manager(), PERIOD)).lines).toHaveLength(3);
    expect((await wf.listAdjustments(manager(), { periodId: PERIOD })).some((a) => a.technicianId === MIA)).toBe(true);
  });
  it('QR handoff: the Tech App must present the live code — a wrong or expired one is refused; the right one confirms once', async () => {
    const [cash] = (await payoutsOf(MIA)).filter((x) => x.method === 'cash');
    await expect(svc.issueHandoffToken(manager(), cash.id)).rejects.toMatchObject({ code: 'PAYOUT_INVALID_STATE' });   // not prepared yet
    await svc.prepareCash(manager(), cash.id, { cashSource: 'safe' });
    await expect(svc.issueHandoffToken(reception(), cash.id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const first = await svc.issueHandoffToken(manager(), cash.id);
    expect(first.handoffCode).toMatch(/^[0-9A-F]{8}$/);
    expect(new Date(first.expiresAt).getTime() - clock.getTime()).toBe(10 * 60 * 1000);
    const row = (await q(`select cash_handoff_token_hash, cash_handoff_token_expires_at from payroll_payouts where id = $1`, [cash.id]))[0];
    expect(row.cash_handoff_token_hash).toHaveLength(64);
    expect(row.cash_handoff_token_hash).not.toContain(first.handoffCode);   // only the hash is stored
    await expect(svc.acknowledgeCashByTechnician(tech(MIA_USER), MIA, cash.id, { handoffCode: 'ZZZZZZZZ' })).rejects.toMatchObject({ code: 'HANDOFF_TOKEN_INVALID' });
    await expect(svc.acknowledgeCashByTechnician(tech(NOA_USER), NOA, cash.id, { handoffCode: first.handoffCode })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });   // another technician
    // a new code replaces the old; the old is refused
    const second = await svc.issueHandoffToken(manager(), cash.id);
    await expect(svc.acknowledgeCashByTechnician(tech(MIA_USER), MIA, cash.id, { handoffCode: first.handoffCode })).rejects.toMatchObject({ code: 'HANDOFF_TOKEN_INVALID' });
    // expired
    clock = new Date(clock.getTime() + 11 * 60 * 1000);
    await expect(svc.acknowledgeCashByTechnician(tech(MIA_USER), MIA, cash.id, { handoffCode: second.handoffCode })).rejects.toMatchObject({ code: 'HANDOFF_TOKEN_INVALID' });
    expect((await stmtOf(MIA)).status).not.toBe('paid');
    const third = await svc.issueHandoffToken(manager(), cash.id);
    const before = events.filter((e) => e.type === E.PAYOUT_CASH_ACKNOWLEDGED).length;
    const ok = await svc.acknowledgeCashByTechnician(tech(MIA_USER), MIA, cash.id, { handoffCode: third.handoffCode });
    expect(ok).toMatchObject({ cashStatus: 'acknowledged', status: 'paid', cashAckMethod: 'qr_handoff', cashHandoffTokenExpiresAt: null });
    const again = await svc.acknowledgeCashByTechnician(tech(MIA_USER), MIA, cash.id, { handoffCode: third.handoffCode });   // a retry is one confirmation
    expect(again.cashAckMethod).toBe('qr_handoff');
    expect(events.filter((e) => e.type === E.PAYOUT_CASH_ACKNOWLEDGED).length - before).toBe(1);
    expect((await q(`select cash_handoff_token_hash from payroll_payouts where id = $1`, [cash.id]))[0].cash_handoff_token_hash).toBeNull();
    const mia = await stmtOf(MIA);
    expect(Number(mia.paid_cents)).toBe(27400);
    expect(mia.status).toBe('partially_paid');
  });
  it('signature: the technician\'s PIN AND a signature on the manager\'s device — strokes kept, bitmaps refused', async () => {
    const [cash] = (await payoutsOf(LEO)).filter((x) => x.method === 'cash');
    await svc.prepareCash(manager(), cash.id, { cashSource: 'safe' });
    await expect(svc.acknowledgeCashBySignature(manager(), cash.id, { pin: '3333', signature: 'data:image/png;base64,AAAA' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(svc.acknowledgeCashBySignature(manager(), cash.id, { pin: '0000', signature: 'M 10 20 L 40 50 L 80 30' })).rejects.toMatchObject({ code: 'PIN_INVALID' });
    await expect(svc.acknowledgeCashBySignature(reception(), cash.id, { pin: '3333', signature: 'M 10 20 L 40 50 L 80 30' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await q(`select cash_status from payroll_payouts where id = $1`, [cash.id]))[0].cash_status).toBe('ready_for_handoff');
    const ok = await svc.acknowledgeCashBySignature(manager(), cash.id, { pin: '3333', signature: 'M 10 20 L 40 50 L 80 30', deviceId: 'pos-1' });
    expect(ok).toMatchObject({ cashStatus: 'acknowledged', status: 'paid', cashAckMethod: 'signature', cashAckSignature: 'M 10 20 L 40 50 L 80 30', cashHandedOffBy: MGR });
    expect(audits.some((a) => a.action === 'cash.acknowledged' && a.resourceId === cash.id && a.metadata.method === 'signature')).toBe(true);
  });
  it('manager + technician dual: the manager (fresh step-up at the route) and the technician\'s PIN — the co-confirmer is stamped', async () => {
    // Noa's statement is all check; give the dual path a cash payout by voiding her check and re-planning the amount in cash
    const [check] = (await payoutsOf(NOA)).filter((x) => x.method === 'check');
    await svc.issueCheck(manager(), check.id, { checkNumber: '7001' });
    await svc.voidCheck(manager(), check.id, { reason: 'Noa wants cash after all' });
    const cash = await svc.addPayout(manager(), (await stmtOf(NOA)).id, { method: 'cash' });
    expect(cash.amountCents).toBe(10000);
    await svc.prepareCash(manager(), cash.id, { cashSource: 'bank_withdrawal' });
    await svc.handOffCash(manager(), cash.id);
    await expect(svc.acknowledgeCashDual(manager(), cash.id, { pin: '9999' })).rejects.toMatchObject({ code: 'PIN_INVALID' });
    const ok = await svc.acknowledgeCashDual(manager(), cash.id, { pin: '2222', deviceId: 'pos-1' });
    expect(ok).toMatchObject({ cashStatus: 'acknowledged', status: 'paid', cashAckMethod: 'manager_dual', cashAckConfirmedBy: MGR });
    expect(audits.some((a) => a.action === 'cash.acknowledged' && a.resourceId === cash.id && a.metadata.coConfirmedBy === MGR)).toBe(true);
    expect((await stmtOf(NOA)).status).toBe('paid');
  });
  it('every cent still reconciles: paid + unpaid = payable on each statement, and the preparation report agrees', async () => {
    for (const t of [MIA, NOA, LEO]) {
      const s = await stmtOf(t);
      const paid = (await payoutsOf(t)).filter((x) => x.status === 'paid').reduce((a, x) => a + Number(x.amount_cents), 0);
      expect(Number(s.paid_cents)).toBe(paid);
      expect(Number(s.paid_cents) + Math.max(0, Number(s.approved_payable_cents) - Number(s.paid_cents))).toBe(Number(s.approved_payable_cents));
    }
    const r = await svc.preparation(manager(), PERIOD);
    expect(r.totals.reconciles).toBe(true);
    expect(r.totals.paidCents).toBe(27400 + 4000 + 10000);
    expect(r.totals.unpaidCents).toBe(72800 - 41400);
    expect(r.cash).toMatchObject({ acknowledged: 3, toPrepare: 0 });
    expect(r.checks).toMatchObject({ toIssue: 2 });   // Mia's and Leo's checks still to issue (Noa's voided one is not a line)
    expect(r.checks.lines.every((l) => l.checkStatus !== 'voided')).toBe(true);
    // the paycheck report's accounting still reconciles too
    const rep = await svc.report(owner(), { range: 'custom', from: '2026-10-01', to: '2026-10-31' });
    expect(rep.accounting.reconciles).toBe(true);
  });
});
