// payroll-wave2.postgres-race.vitest.spec.ts — REAL Postgres (PG_RACE_URL opt-in, our convention), Payroll mandate wave 2
// (Oct 12 2026). The money paths under real concurrency, end to end on the real engine:
//   Service done → paid ticket → compensation snapshot (the ONE engine) → pay period built in the SALON's zone (the last
//   day counts) → prepare → 10 simultaneous approvals (one transition, one event) → payouts bounded by payable under
//   10-way races → idempotent mark-paid → a refund AFTER the lock lands in the next open period (replayed 10×, once) while
//   the locked lines stay untouched → adjustment idempotency → tip lock → recovery worker (missing snapshot, chargeback
//   pro-rata review, won → rejected) → tenant isolation, receptionist refusals, technician privacy, export audit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { OutboxWriter } from '@aipowersalon/events';
import { permissionsFor } from '@aipowersalon/permissions';
import { PayrollService } from './payroll.service';
import { KyselyPayrollRepository } from './payroll.kysely.repository';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollSelfService } from './payroll-self.service';
import { PayrollAutoBuildAdapter } from '../compensation/compensation-autobuild.adapter';
import { CompensationService } from '../compensation/compensation.service';
import { KyselyCompensationPorts } from '../compensation/compensation.kysely.ports';
import { CompensationRecoveryWorker } from '../compensation/compensation-recovery';
import { TipAllocationService } from '../compensation/compensation-tip-allocation.service';

const url = process.env.PG_RACE_URL;
const U = (n: number) => `d7a90000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SVC = U(14), CAT = U(15);
const T = U(1), TB = U(2), B = U(3), BB = U(4), CUST = U(5), TA = U(6), TB2 = U(7), OWNER = U(8), TECH_USER = U(9), CUST_B = U(10);
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] });
const reception = () => ({ tenantId: T, branchId: B, userId: U(11), role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') as string[] });
const manager = () => ({ tenantId: T, branchId: B, userId: U(12), role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] });
const otherSalon = () => ({ tenantId: TB, branchId: BB, userId: U(13), role: 'OWNER', permissions: permissionsFor('OWNER') as string[] });
let db: Kysely<any>; let pool: pg.Pool;
let payroll: PayrollService; let wf: PayrollWorkflowService; let comp: CompensationService;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const codeOf = (r: PromiseSettledResult<any>) => (r.status === 'rejected' ? (r.reason as any)?.code : 'OK');

async function paidTicket(id: string, paidAtIso: string, tipCents: number, lines: { id: string; tech: string; total: number; pct: number }[]) {
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, tip_cents, paid_at, chosen_payment_method)
    values (${id}, ${T}, ${B}, ${CUST}, 'paid', ${lines.reduce((a, l) => a + l.total, 0)}, ${lines.reduce((a, l) => a + l.total, 0)}, ${tipCents}, ${paidAtIso}, 'card')`.execute(db);
  for (const l of lines) {
    await sql`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot, rule_source)
      values (${l.id}, ${T}, ${B}, ${id}, ${SVC}, ${l.tech}, 'Gel', ${l.total}, 45, ${l.total}, 'percent', ${l.pct}, 'Technician + Service')`.execute(db);
  }
  await sql`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${U(500 + Number(id.slice(-4)))}, ${T}, ${B}, ${id}, 'card', ${lines.reduce((a, l) => a + l.total, 0) + tipCents}, ${tipCents}, 'approved')`.execute(db);
}

describe.skipIf(!url)('payroll wave 2 — money paths on real Postgres', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    for (const t of ['compensation_adjustments', 'compensation_exceptions', 'payroll_payouts', 'payroll_exports', 'payroll_inquiries', 'ticket_tip_allocations', 'ticket_compensation_snapshots', 'chargebacks', 'payments', 'ticket_service_lines', 'tickets', 'payroll_periods', 'payroll_lines', 'technician_pay_plans', 'compensation_deduction_types'])
      await sql`delete from ${sql.table(t)} where tenant_id in (${T}, ${TB})`.execute(db);
    await sql`delete from outbox_events where tenant_id in (${T}, ${TB})`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Wave2 LLC', 'Wave2', 'pay-w2-a', 'PAYW2A', 'active'), (${TB}, 'Other LLC', 'Other', 'pay-w2-b', 'PAYW2B', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Cherry Hill', 'active', 'America/New_York'), (${BB}, ${TB}, 'Other', 'active', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${B}, 'Ann', 'Guest', 'Ann Guest'), (${CUST_B}, ${TB}, ${BB}, 'Bo', 'Guest', 'Bo Guest') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 45, 5000) on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password) values (${TECH_USER}, ${T}, ${B}, 'Lisa', 'w2-lisa@x.test', 'active', 'TECHNICIAN', false, false) on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, status, is_active) values (${TA}, ${T}, ${B}, ${TECH_USER}, 'Lisa', 'N', 'Lisa N', 'active', true), (${TB2}, ${T}, ${B}, null, 'Mary', 'K', 'Mary K', 'active', true) on conflict (id) do nothing`.execute(db);
    comp = new CompensationService(new KyselyCompensationPorts(db as any), { warn: () => undefined, error: () => undefined });
    payroll = new PayrollService(new KyselyPayrollRepository(db as any, new OutboxWriter()), undefined, new PayrollAutoBuildAdapter(db as any));
    wf = new PayrollWorkflowService(db as any, { outbox: new OutboxWriter(), builder: payroll, autoBuild: new PayrollAutoBuildAdapter(db as any), snapshots: comp });
    payroll.useWorkflow(wf);
    // two tickets in the June 1–15 period; the second is paid at 23:30 New York on the LAST day (03:30Z on the 16th)
    await paidTicket(U(1001), '2026-06-10T15:00:00Z', 2101, [{ id: U(2001), tech: TA, total: 10000, pct: 60 }, { id: U(2002), tech: TB2, total: 5000, pct: 50 }]);
    await paidTicket(U(1002), '2026-06-16T03:30:00Z', 0, [{ id: U(2003), tech: TA, total: 4500, pct: 60 }]);
    for (const t of [U(1001), U(1002)]) expect((await comp.snapshotPaidTicket({ tenantId: T, branchId: B }, t)).ok).toBe(true);
  }, 120_000);
  afterAll(async () => { if (db) await db.destroy(); });

  let P1 = '';
  it('builds the period in the salon zone — the last day counts — and 10 simultaneous approvals are ONE transition + ONE event', async () => {
    P1 = (await payroll.createPeriod(owner(), { label: 'Jun 1–15', periodStart: '2026-06-01', periodEnd: '2026-06-15' })).id;
    const prepared = await wf.prepare(owner(), P1);
    expect(prepared.period.status).toBe('review');
    const lisa = prepared.lines.find((l) => l.technicianId === TA)!;
    expect(lisa.commissionCents).toBe(6000 + 2700);   // 60% of 10000 + 60% of 4500 (the 23:30-on-the-15th ticket — dropped before the fix)
    expect(lisa.tipsCents + prepared.lines.find((l) => l.technicianId === TB2)!.tipsCents).toBe(2101);   // §147 Σ tips == tip, odd cent kept
    expect(prepared.validation.blocking).toBe(0);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => wf.approve(owner(), P1)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => ['PAYROLL_PERIOD_ALREADY_APPROVED', 'PAYROLL_VERSION_CONFLICT'].includes(codeOf(r)))).toBe(true);
    const ev = await q(sql`select count(*)::int as n from outbox_events where tenant_id = ${T} and event_type = 'payroll.period_finalized' and aggregate_id = ${P1}`);
    expect(ev[0].n).toBe(1);
    const row = (await q(sql`select status, approval_hash, approved_by, version from payroll_periods where id = ${P1}`))[0];
    expect(row.status).toBe('finalized'); expect(row.approval_hash).toMatch(/^[0-9a-f]{64}$/); expect(row.approved_by).toBe(OWNER);
  });

  it('a stale expectedVersion / changed hash is PAYROLL_VERSION_CONFLICT, and a locked line refuses a direct UPDATE at the database', async () => {
    const P = (await payroll.createPeriod(owner(), { periodStart: '2026-05-01', periodEnd: '2026-05-15' })).id;
    const d = await wf.detail(owner(), P);
    await expect(wf.approve(owner(), P, { expectedVersion: (d.period.version ?? 1) + 7 })).rejects.toMatchObject({ code: 'PAYROLL_VERSION_CONFLICT' });
    await expect(wf.approve(owner(), P, { calculationHash: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'PAYROLL_VERSION_CONFLICT' });
    await expect(sql`update payroll_lines set payable_cents = 1 where period_id = ${P1}`.execute(db)).rejects.toThrow(/finalized; its lines are locked/);
  });

  it('10 simultaneous partial payouts never exceed the payable (§149); an idempotency key replayed 10× is one payout', async () => {
    const lisa = (await wf.detail(owner(), P1)).lines.find((l) => l.technicianId === TA)!;
    const chunk = Math.floor(lisa.payableCents * 0.4);
    const res = await Promise.allSettled(Array.from({ length: 10 }, () => wf.recordPayout(owner(), P1, { technicianId: TA, amountCents: chunk, method: 'cash' })));
    expect(res.map((r) => (r.status === 'rejected' ? `${codeOf(r)}:${(r.reason as any)?.message}` : 'OK')).filter((x) => x === 'OK')).toHaveLength(2);
    expect(res.filter((r) => r.status === 'rejected').every((r) => codeOf(r) === 'PAYOUT_EXCEEDS_PAYABLE')).toBe(true);
    const mary = (await wf.detail(owner(), P1)).lines.find((l) => l.technicianId === TB2)!;
    const rep = await Promise.allSettled(Array.from({ length: 10 }, () => wf.recordPayout(owner(), P1, { technicianId: TB2, amountCents: 100, method: 'check', idempotencyKey: 'chk-1001' })));
    expect(rep.every((r) => r.status === 'fulfilled')).toBe(true);
    expect((await q(sql`select count(*)::int as n from payroll_payouts where tenant_id = ${T} and idempotency_key = 'chk-1001'`))[0].n).toBe(1);
    expect(mary.payableCents).toBeGreaterThan(100);
  });

  it('mark-paid ×5 at once: one transition, the rest are no-ops; Σ paid == payable on every line (§78/§149)', async () => {
    const res = await Promise.allSettled(Array.from({ length: 5 }, () => wf.markPaid(owner(), P1, { method: 'direct_deposit', reference: 'ACH-0612' })));
    expect(res.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(res.filter((r) => r.status === 'fulfilled' && !(r as any).value.alreadyPaid)).toHaveLength(1);
    const d = await wf.detail(owner(), P1);
    expect(d.period.status).toBe('paid');
    for (const l of d.lines) { expect(l.paidCents).toBe(l.payableCents); expect(l.outstandingCents).toBe(0); }
    expect(d.totals.paidCents).toBe(d.totals.payableCents);
    expect((await q(sql`select count(*)::int as n from outbox_events where aggregate_id = ${P1} and event_type = 'payroll.period_paid'`))[0].n).toBe(1);
    await expect(wf.reopen(owner(), P1, { reason: 'mistake' })).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_LOCKED' });
  });

  let P2 = '';
  it('a refund AFTER the lock: replayed 10× → one set of entries in the NEXT OPEN period, linked to the locked one; history untouched', async () => {
    P2 = (await payroll.createPeriod(owner(), { label: 'Jun 16–30', periodStart: '2026-06-16', periodEnd: '2026-06-30' })).id;
    const before = await q(sql`select technician_id, payable_cents, commission_cents from payroll_lines where period_id = ${P1} order by technician_id`);
    const refundId = U(3001);
    const res = await Promise.all(Array.from({ length: 10 }, () => comp.reverseForRefund({ tenantId: T, branchId: B }, U(1001), { type: 'partial', refundedCents: 2500, capturedCents: 15000, refundPaymentId: refundId }, { reason: 'customer refund', requestedBy: OWNER })));
    expect(res.every((r) => r.ok)).toBe(true);
    const rows = await q(sql`select category, amount_cents, status, period_id, original_period_id from compensation_adjustments where tenant_id = ${T} and refund_payment_id = ${refundId} order by technician_id`);
    expect(rows.length).toBe(2);   // Lisa + Mary commission, once each
    expect(rows.every((r) => r.period_id === P2 && r.original_period_id === P1 && r.status === 'pending')).toBe(true);
    expect(rows.reduce((a, r) => a + Number(r.amount_cents), 0)).toBe(-Math.round((6000 + 2500) * (2500 / 15000)));   // §52 pro-rata exact
    expect(await q(sql`select technician_id, payable_cents, commission_cents from payroll_lines where period_id = ${P1} order by technician_id`)).toEqual(before);
    expect((await q(sql`select count(*)::int as n from compensation_exceptions where tenant_id = ${T} and kind = 'refund_closed_period'`))[0].n).toBe(1);
    // the owner approves them into P2 (step-up at the route); P2's build then carries the reversal
    const pending = await wf.listAdjustments(owner(), { status: 'pending' });
    for (const a of pending.filter((x) => x.periodId === P2)) await wf.decideAdjustment(owner(), a.id, { decision: 'approve' });
    const p2 = await wf.detail(owner(), P2);
    expect(p2.lines.find((l) => l.technicianId === TA)!.adjustmentCents).toBe(-1000);
  });

  it('a manual adjustment with one idempotency key, sent 10× at once, is ONE adjustment (§186); a receptionist can do none of it (§191)', async () => {
    const res = await Promise.allSettled(Array.from({ length: 10 }, () => wf.createAdjustment(owner(), P2, { technicianId: TA, category: 'bonus', amountCents: 2500, reasonCode: 'performance_bonus', reason: 'June top seller', idempotencyKey: 'bonus-lisa-june' })));
    expect(res.filter((r) => r.status === 'rejected').map((r) => `${codeOf(r)}:${(r as any).reason?.message}`)).toEqual([]);
    expect((await q(sql`select count(*)::int as n from compensation_adjustments where tenant_id = ${T} and idempotency_key = 'bonus-lisa-june'`))[0].n).toBe(1);
    expect((await wf.detail(owner(), P2)).lines.find((l) => l.technicianId === TA)!.bonusCents).toBe(2500);
    for (const fn of [() => wf.approve(reception(), P2), () => wf.exportPeriod(reception(), P2, 'csv'), () => wf.markPaid(reception(), P2),
      () => wf.createAdjustment(reception(), P2, { technicianId: TA, category: 'deduction', amountCents: 100, reasonCode: 'supply_charge', reason: 'x', deductionType: 'supply' }),
      () => wf.createPayPlan(reception(), { technicianId: TA, payType: 'hourly', hourlyRateCents: 1500, effectiveStart: '2026-07-01' })]) {
      await expect(fn()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
    await expect(wf.approve(manager(), P2)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });   // payroll.approve is the owner's by default
    await expect(wf.exportPeriod(manager(), P1, 'csv')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });   // a manager SEES payroll, exporting it is payroll.export
    await expect(wf.recordPayout(manager(), P1, { technicianId: TA, amountCents: 1, method: 'cash' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('tenant isolation (§188), technician privacy (§189), export audit (§83)', async () => {
    await expect(wf.detail(otherSalon(), P1)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_FOUND' });
    await expect(wf.approve(otherSalon(), P2)).rejects.toMatchObject({ code: 'PAYROLL_PERIOD_NOT_FOUND' });
    const self = new PayrollSelfService(db as any);
    expect((await self.payouts(T, TA)).every((p) => p.periodId === P1)).toBe(true);
    expect(await self.payouts(TB, TA)).toEqual([]);   // another salon sees nothing of hers
    await expect(self.createInquiry(T, B, TA, TECH_USER, { message: 'Why is my June tip lower?', periodId: U(9999) })).rejects.toThrow(/not one of yours/);
    const asked = await self.createInquiry(T, B, TA, TECH_USER, { message: 'Why is my June tip lower?', periodId: P1 });
    await wf.respondInquiry(owner(), asked.id, { response: 'A customer refund on June 10.', privateNote: 'checked refund 3001' });
    const mine = await self.inquiries(T, TA);
    expect(mine[0].response).toBe('A customer refund on June 10.'); expect((mine[0] as any).privateNote).toBeUndefined();   // §153
    const exp = await wf.exportPeriod(owner(), P1, 'csv');
    expect(Buffer.from(exp.base64, 'base64').toString('utf8')).toContain('Lisa N');
    expect((await q(sql`select content_sha256, exported_by, format from payroll_exports where period_id = ${P1}`))[0]).toMatchObject({ content_sha256: exp.sha256, exported_by: OWNER, format: 'csv' });
  });

  it('tip lock (§28): a paid ticket refuses a silent re-split; with a reason the correction lands in the next open period', async () => {
    const tips = new TipAllocationService(db as any);
    const ctx = { ...owner(), permissions: [...owner().permissions] } as any;
    await expect(tips.allocate(ctx, U(1001), { allocations: [{ technicianId: TA, tipCents: 2101 }, { technicianId: TB2, tipCents: 0 }] })).rejects.toMatchObject({ code: 'TIP_ALLOCATION_LOCKED' });
    const r = await tips.allocate(ctx, U(1001), { allocations: [{ technicianId: TA, tipCents: 1500 }, { technicianId: TB2, tipCents: 601 }], reason: 'Customer asked: Lisa $15, Mary $6.01' });
    expect(r.corrections).toBe(2);
    const corr = await q(sql`select technician_id, amount_cents, period_id, original_period_id from compensation_adjustments where tenant_id = ${T} and ticket_id = ${U(1001)} and category = 'tip_correction' order by amount_cents`);
    expect(corr.reduce((a, c) => a + Number(c.amount_cents), 0)).toBe(0);   // §26 never lose / create cents
    expect(corr.every((c) => c.period_id === P2 && c.original_period_id === P1)).toBe(true);
  });

  it('recovery worker (§196–§197, §55): a missing snapshot is detected and recovered; a partial chargeback reverses pro-rata into review once; won → rejected', async () => {
    await paidTicket(U(1003), '2026-06-20T15:00:00Z', 0, [{ id: U(2004), tech: TA, total: 8000, pct: 60 }]);
    const worker = new CompensationRecoveryWorker(db as any, comp, () => Date.parse('2026-06-25T12:00:00Z'));
    const r1 = await worker.runOnce(T);
    expect(r1.detectedMissing).toBe(1); expect(r1.recovered).toBe(1);
    expect((await q(sql`select status from compensation_exceptions where tenant_id = ${T} and kind = 'missing_snapshot'`))[0].status).toBe('resolved');
    expect((await q(sql`select count(*)::int as n from ticket_compensation_snapshots where ticket_id = ${U(1003)}`))[0].n).toBe(1);
    const pay = (await q(sql`select id from payments where ticket_id = ${U(1003)}`))[0].id;
    await sql`insert into chargebacks (id, tenant_id, branch_id, payment_id, chargeback_id, amount_cents, status, opened_at) values (${U(4001)}, ${T}, ${B}, ${pay}, 'CASE-1', 2000, 'open', '2026-06-22T10:00:00Z')`.execute(db);
    await worker.runOnce(T); await worker.runOnce(T);
    const cb = await q(sql`select category, amount_cents, status from compensation_adjustments where chargeback_id = ${U(4001)}`);
    expect(cb).toHaveLength(1); expect(cb[0]).toMatchObject({ category: 'chargeback_reversal', status: 'pending_review' });
    expect(Number(cb[0].amount_cents)).toBe(-1200);   // 4800 × 2000 / 8000
    await sql`update chargebacks set status = 'won' where id = ${U(4001)}`.execute(db);
    expect((await worker.runOnce(T)).chargebacksWon).toBe(1);
    expect((await q(sql`select status from compensation_adjustments where chargeback_id = ${U(4001)}`))[0].status).toBe('rejected');
  });
});
