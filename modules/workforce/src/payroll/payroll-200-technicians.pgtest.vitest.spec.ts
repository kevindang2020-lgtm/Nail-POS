// payroll-200-technicians.pgtest — the "200-Technician Large Salon" mandate, payroll items §63–§65, §68, on the REAL schema
// (PGlite, every migration). One salon, one branch (+ a second branch some technicians also work at), 200 technicians on
// mixed pay (commission, hourly from the time clock, salary, commission + a weekly guarantee), card + cash tips, bonuses
// and deductions from the adjustments ledger — run through the real service path:
//   calculate (the ONE build from sales → statements → default 50 / 50 plans) → list view → "50 / 50 for everyone"
//   → manager submit → owner approve (lock + materialise one payout per instruction) → a check issued (recompute)
// and asserts 200 statements, exactly 400 payout instructions / payouts (200 check + 200 cash), Σ per statement = the
// approved payable, and totals that reconcile. §65: every period-level step's SQL round trips are counted (a wrapper on the
// PGlite connection) and the same steps for 20 technicians are compared — the payroll layer's own queries must not grow
// with the technician count. Queries made inside the compensation auto-build ports (modules/workforce/src/compensation —
// outside the payroll layer) and the outbox event inserts are counted separately and reported, not hidden — and since the
// auto-build reads each fact kind set-based (Oct 23 2026) the TOTAL round trips of every step are asserted flat too (the
// outbox still carries one ROW per domain event, now as multi-row inserts). A last block proves the batch auto-build
// produces exactly the lines of the per-technician path on a salon seeded with every fact kind. Timings and counts are
// printed for the performance report.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';
import { OutboxWriter } from '@aipowersalon/events';
import { PayrollService } from './payroll.service';
import { KyselyPayrollRepository } from './payroll.kysely.repository';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollPaycheckService } from './payroll-paycheck.service';
import { PayrollAutoBuildAdapter } from '../compensation/compensation-autobuild.adapter';
import { autoBuildPeriod, type AutoBuildPorts } from '../compensation/compensation-payroll-autobuild';
import { resolveEarningsWindow } from '../compensation/earnings-period';

type Pg = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }> };
type Counts = { payroll: number; autobuild: number; outbox: number; outboxRows: number; tx: number; total: number };
const STEPS = ['calculate', 'periodStatements', 'applyDefaultToAll', 'submit', 'approve', 'issueCheck'] as const;
type Step = typeof STEPS[number];

let pg: Pg;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as Array<Record<string, unknown>>;
/** a deterministic uuid per (salon, kind, n) */
const uid = (salon: number, kind: number, n: number) => `${String(salon).padStart(4, '0')}${String(kind).padStart(4, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Counting connection: every round trip goes through here. While an auto-build port call is in flight the query is
 *  attributed to `autobuild`; an outbox insert to `outbox`; BEGIN / COMMIT / ROLLBACK to `tx`; everything else is the
 *  payroll layer's own SQL. (PGlite is one session and every step is awaited in sequence, so the attribution is exact.) */
class Meter {
  portDepth = 0;
  c: Counts = { payroll: 0, autobuild: 0, outbox: 0, outboxRows: 0, tx: 0, total: 0 };
  reset() { this.c = { payroll: 0, autobuild: 0, outbox: 0, outboxRows: 0, tx: 0, total: 0 }; }
  record(sqlText: string) {
    this.c.total++;
    const s = sqlText.trim().toLowerCase();
    if (s === 'begin' || s === 'commit' || s === 'rollback') this.c.tx++;
    else if (this.portDepth > 0) this.c.autobuild++;
    else if (/^insert into "outbox_events"/.test(s)) { this.c.outbox++; this.c.outboxRows += 1 + (s.match(/\)\s*,\s*\(/g)?.length ?? 0); }
    else this.c.payroll++;
  }
  connection(inner: Pg): Pg { return { query: (s, p) => { this.record(s); return inner.query(s, p); } }; }
  ports(inner: PayrollAutoBuildAdapter): AutoBuildPorts {
    return new Proxy(inner, {
      get: (target, prop, recv) => {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== 'function') return v;
        return async (...args: unknown[]) => { this.portDepth++; try { return await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args); } finally { this.portDepth--; } };
      },
    }) as unknown as AutoBuildPorts;
  }
}

interface Salon {
  n: number; tenantId: string; branchId: string; branch2: string; periodId: string; ownerId: string; managerId: string;
  svc: PayrollPaycheckService; wf: PayrollWorkflowService; meter: Meter;
  results: Partial<Record<Step, { ms: number; counts: Counts }>>;
}

async function seedSalon(base: Pg, salon: number, technicians: number): Promise<Salon> {
  const T = uid(salon, 1, 1), B = uid(salon, 2, 1), B2 = uid(salon, 2, 2), OWNER = uid(salon, 3, 1), MGR = uid(salon, 3, 2), PERIOD = uid(salon, 4, 1);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, owner_user_id) values ($1,$2,$2,$3,$4,'active',$5)`,
    [T, `Large Salon ${salon}`, `large-salon-${salon}`, `LRG${String(salon).padStart(3, '0')}`, OWNER]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Main','active','America/New_York'), ($2,$3,'Annex','active','America/New_York')`, [B, B2, T]);
  await q(`insert into compensation_deduction_types (tenant_id, key, label, enabled) values ($1, 'supplies', 'Supplies', true)`, [T]);
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status) values ($1,$2,null,'Week of Oct 12','2026-10-12','2026-10-18','draft')`, [PERIOD, T]);

  const techRows: unknown[][] = [], snaps: unknown[][] = [], plans: unknown[][] = [], shifts: unknown[][] = [], guarantees: unknown[][] = [], adjustments: unknown[][] = [];
  for (let i = 0; i < technicians; i++) {
    const tech = uid(salon, 10, i);
    techRows.push([tech, T, i % 7 === 0 ? B2 : B, `Tech${i}`, `L${i}`, `Tech${i} L${i}`]);
    const kind = i % 10;   // 0–5 commission · 6–7 hourly · 8 salary · 9 commission with a weekly guarantee
    const tickets = kind === 9 ? 1 : 3 + (i % 4);
    for (let k = 0; k < tickets; k++) {
      const gross = 4_000 + ((i * 37 + k * 101) % 6_000);
      const earn = Math.floor(gross * (kind === 9 ? 0.4 : 0.6));
      const cardTip = (i + k) % 3 === 0 ? 0 : 500 + ((i * 13 + k) % 900);
      const cashTip = (i + k) % 5 === 0 ? 300 + (i % 200) : 0;
      const branch = (i % 7 === 0 && k === 0) || (i % 11 === 0 && k === 1) ? B2 : B;
      snaps.push([T, branch, uid(salon, 20, i * 10 + k), uid(salon, 21, i * 10 + k), tech, gross, earn, cardTip, cashTip, k === 0 && i % 4 === 0 ? 250 : 0, `2026-10-${13 + (k % 5)}T16:00:00Z`]);
    }
    if (kind === 6 || kind === 7) {
      plans.push([T, tech, 'hourly', 2_000 + (i % 5) * 100, null]);
      for (const d of [13, 14]) shifts.push([T, B, tech, `2026-10-${d}`, `2026-10-${d}T13:00:00Z`, `2026-10-${d}T21:00:00Z`]);
    }
    if (kind === 8) plans.push([T, tech, 'salary', null, 80_000 + (i % 3) * 5_000]);
    if (kind === 9) guarantees.push([T, tech, 100_000]);
    if (i % 25 === 3) adjustments.push([T, tech, PERIOD, 'bonus', 5_000, 'performance_bonus', null]);
    if (i % 40 === 5) adjustments.push([T, tech, PERIOD, 'deduction', -1_000, 'supply_charge', 'supplies']);
  }
  const insertMany = async (head: string, rows: unknown[][], tail = '') => {
    for (let at = 0; at < rows.length; at += 200) {
      const chunk = rows.slice(at, at + 200); const params: unknown[] = [];
      const values = chunk.map((r) => `(${r.map((v) => { params.push(v); return `$${params.length}`; }).join(',')}${tail})`).join(',');
      await q(`${head} values ${values}`, params);
    }
  };
  await insertMany(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active)`, techRows, `,'active',true`);
  await insertMany(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, gross_price_cents, tech_service_earnings_cents, card_tip_cents, cash_tip_cents, retail_commission_cents, snapshot_at, engine_version, rule_source, commissionable_cents)`,
    snaps.map((s) => s.slice(0, 11)), `,'v-test','Technician + Service',0`);
  await insertMany(`insert into technician_pay_plans (tenant_id, technician_id, pay_type, hourly_rate_cents, salary_cents_per_period, effective_start, status)`, plans, `,'2026-01-01','active'`);
  if (shifts.length) await insertMany(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status)`, shifts, `,'completed'`);
  if (guarantees.length) await insertMany(`insert into technician_guarantee_policies (tenant_id, technician_id, guaranteed_cents, period, effective_start, status)`, guarantees, `,'week','2026-01-01T00:00:00Z','active'`);
  if (adjustments.length) await insertMany(`insert into compensation_adjustments (tenant_id, technician_id, period_id, category, amount_cents, reason_code, deduction_type, reason, status, source)`, adjustments, `,'Large-salon seed','approved','manual'`);

  const meter = new Meter();
  const db = kyselyFor(meter.connection(base));
  const outbox = new OutboxWriter();
  const autoBuild = meter.ports(new PayrollAutoBuildAdapter(db));
  const payroll = new PayrollService(new KyselyPayrollRepository(db, outbox), undefined, autoBuild);
  const wf = new PayrollWorkflowService(db, { outbox, builder: payroll, autoBuild });
  payroll.useWorkflow(wf);
  const svc = new PayrollPaycheckService(db, { workflow: wf, builder: payroll, outbox });
  wf.paychecks = svc;
  return { n: technicians, tenantId: T, branchId: B, branch2: B2, periodId: PERIOD, ownerId: OWNER, managerId: MGR, svc, wf, meter, results: {} };
}

const ownerCtx = (s: Salon) => ({ tenantId: s.tenantId, branchId: s.branchId, userId: s.ownerId, role: 'OWNER', permissions: permissionsFor('OWNER') as string[] });
const managerCtx = (s: Salon) => ({ tenantId: s.tenantId, branchId: s.branchId, userId: s.managerId, role: 'MANAGER', permissions: permissionsFor('MANAGER') as string[] });

async function measure<T>(s: Salon, step: Step, fn: () => Promise<T>): Promise<T> {
  s.meter.reset();
  const t0 = performance.now();
  const out = await fn();
  s.results[step] = { ms: Math.round(performance.now() - t0), counts: { ...s.meter.c } };
  return out;
}

async function runWeek(s: Salon) {
  const calc = await measure(s, 'calculate', () => s.svc.calculate(managerCtx(s), s.periodId));
  const view = await measure(s, 'periodStatements', () => s.svc.periodStatements(managerCtx(s), s.periodId));
  await measure(s, 'applyDefaultToAll', () => s.svc.applyDefaultToAll(managerCtx(s), s.periodId));
  const submitted = await measure(s, 'submit', () => s.svc.submit(managerCtx(s), s.periodId));
  const approved = await measure(s, 'approve', () => s.svc.approve(ownerCtx(s), s.periodId));
  const firstCheck = (await q(`select id from payroll_payouts where tenant_id = $1 and period_id = $2 and method = 'check' order by id limit 1`, [s.tenantId, s.periodId]))[0];
  await measure(s, 'issueCheck', () => s.svc.issueCheck(managerCtx(s), String(firstCheck.id), { checkNumber: `LS${s.n}-1` }));
  return { calc, view, submitted, approved };
}

let small: Salon; let large: Salon;
let largeRun: Awaited<ReturnType<typeof runWeek>>;

beforeAll(async () => {
  pg = (await migratedPglite()) as unknown as Pg;
  small = await seedSalon(pg, 1, 20);
  large = await seedSalon(pg, 2, 200);
  await runWeek(small);
  largeRun = await runWeek(large);
  const row = (s: Salon, step: Step) => { const r = s.results[step]!; return `${step.padEnd(18)} ${String(s.n).padStart(4)} techs  ${String(r.ms).padStart(6)} ms  payroll=${String(r.counts.payroll).padStart(4)}  autobuild=${String(r.counts.autobuild).padStart(5)}  outbox=${String(r.counts.outbox).padStart(4)} (${String(r.counts.outboxRows).padStart(3)} rows)  tx=${String(r.counts.tx).padStart(3)}  total=${String(r.counts.total).padStart(5)}`; };
  console.log(['', '── payroll performance: 20 vs 200 technicians (PGlite) ──', ...STEPS.flatMap((st) => [row(small, st), row(large, st)]), ''].join('\n'));
}, 600_000);

describe('200-technician large salon — weekly payroll (§63–§65, §68)', () => {
  it('§63: one statement per technician from the one build, mixed pay types all present', async () => {
    expect(largeRun.calc.statements).toHaveLength(200);
    const st = largeRun.approved.statements;
    expect(st).toHaveLength(200);
    expect(st.filter((x) => x.hourlyPayCents > 0).length).toBe(40);
    expect(st.filter((x) => x.salaryPayCents > 0).length).toBe(20);
    expect(st.filter((x) => x.guaranteeTopUpCents > 0).length).toBe(20);
    expect(st.filter((x) => x.serviceCommissionCents > 0).length).toBe(140);   // hourly / salary plans do not pay commission
    expect(st.filter((x) => x.bonusCents > 0).length).toBe(8);
    expect(st.filter((x) => x.deductionsCents > 0).length).toBe(5);
    expect(st.every((x) => x.tipsCents === x.cardTipCents + x.cashTipCents)).toBe(true);
    expect(st.every((x) => x.status === 'locked' && x.approvedPayableCents > 0)).toBe(true);
    // the branch breakdown is per technician (some worked at the annex too)
    expect(st.filter((x) => x.branchBreakdown.some((b) => b.branchId === large.branch2)).length).toBeGreaterThan(20);
    expect(new Set(st.map((x) => x.statementNumber)).size).toBe(200);
  });

  it('§64 / §68: 200 approved statements at 50 / 50 → exactly 400 payout instructions and 400 payouts (200 check + 200 cash), Σ = payable', async () => {
    const ins = await q(`select i.statement_id, i.method, i.amount_cents, i.basis_points, i.status, i.payout_id from payroll_payout_instructions i
      join payroll_payout_plans p on p.tenant_id = i.tenant_id and p.id = i.plan_id where i.tenant_id = $1 and p.status = 'approved'`, [large.tenantId]);
    expect(ins).toHaveLength(400);
    expect(ins.filter((i) => i.method === 'check')).toHaveLength(200);
    expect(ins.filter((i) => i.method === 'cash')).toHaveLength(200);
    expect(ins.every((i) => i.status === 'materialized' && i.payout_id)).toBe(true);
    const pos = await q(`select id, statement_id, instruction_id, method, amount_cents, status, check_status, cash_status from payroll_payouts where tenant_id = $1 and period_id = $2`, [large.tenantId, large.periodId]);
    expect(pos).toHaveLength(400);
    expect(pos.filter((x) => x.method === 'check')).toHaveLength(200);
    expect(pos.filter((x) => x.method === 'cash')).toHaveLength(200);
    expect(new Set(pos.map((x) => x.instruction_id)).size).toBe(400);
    const byIns = new Map(ins.map((i) => [String(i.payout_id), i]));
    for (const x of pos) expect(Number(byIns.get(String(x.id))!.amount_cents)).toBe(Number(x.amount_cents));
    const stmts = await q(`select id, approved_payable_cents, line_payable_cents, already_paid_cents, status from payroll_statements where tenant_id = $1 and period_id = $2 and status <> 'voided'`, [large.tenantId, large.periodId]);
    expect(stmts).toHaveLength(200);
    for (const s of stmts) {
      const mine = pos.filter((x) => x.statement_id === s.id);
      const payable = Number(s.approved_payable_cents);
      expect(mine).toHaveLength(2);
      expect(mine.reduce((a, x) => a + Number(x.amount_cents), 0)).toBe(payable);
      // the default split: half by check (the odd cent goes to the check), half in cash
      expect(Number(mine.find((x) => x.method === 'check')!.amount_cents)).toBe(Math.ceil(payable / 2));
      expect(Number(mine.find((x) => x.method === 'cash')!.amount_cents)).toBe(Math.floor(payable / 2));
    }
  });

  it('totals reconcile: lines = statements = plans = payouts; check + cash = payable; the event per step is written once', async () => {
    const v = largeRun.approved;
    const lines = (await q(`select coalesce(sum(payable_cents),0)::text as s, count(*)::int as n from payroll_lines where tenant_id = $1 and period_id = $2`, [large.tenantId, large.periodId]))[0];
    const period = (await q(`select total_payable_cents, status, payout_status, owner_decision from payroll_periods where id = $1`, [large.periodId]))[0];
    const payouts = (await q(`select coalesce(sum(amount_cents),0)::text as s from payroll_payouts where tenant_id = $1 and period_id = $2`, [large.tenantId, large.periodId]))[0];
    expect(Number(lines.n)).toBe(200);
    expect(v.totals.technicians).toBe(200);
    expect(v.totals.payableCents).toBe(Number(lines.s) - v.totals.alreadyPaidCents);
    expect(Number(period.total_payable_cents)).toBe(Number(lines.s));
    expect(v.totals.checkCents + v.totals.cashCents).toBe(v.totals.payableCents);
    expect(v.totals.otherCents).toBe(0);
    expect(Number(payouts.s)).toBe(v.totals.payableCents);
    expect(v.totals.overrides).toBe(0);
    expect(v.totals.exceptions).toBe(0);
    expect(period).toMatchObject({ status: 'finalized', payout_status: 'unpaid', owner_decision: 'approved' });
    expect(largeRun.submitted.totals.payableCents).toBe(v.totals.payableCents);
    const ev = await q(`select event_type, count(*)::int as n from outbox_events where tenant_id = $1 group by event_type`, [large.tenantId]);
    const count = (t: string) => Number(ev.find((e) => e.event_type === t)?.n ?? 0);
    expect(count('pay_statement.created')).toBe(200);
    expect(count('payout.planned')).toBe(200);
    expect(count('payroll.submitted_to_owner')).toBe(1);
    expect(count('payroll.period_finalized')).toBe(1);
    const issued = (await q(`select count(*)::int as n from payroll_payouts where tenant_id = $1 and check_status = 'issued'`, [large.tenantId]))[0];
    expect(Number(issued.n)).toBe(1);
  });

  it('§65: the payroll layer is not N+1 — its queries per period-level step do not grow from 20 to 200 technicians', () => {
    for (const step of STEPS) {
      const a = small.results[step]!.counts, b = large.results[step]!.counts;
      // a small constant: chunked multi-row writes may add a round trip per 500 rows; nothing per technician
      expect(b.payroll - a.payroll, `${step}: ${a.payroll} queries for 20 technicians, ${b.payroll} for 200`).toBeLessThanOrEqual(5);
      expect(b.tx - a.tx, `${step}: transactions`).toBeLessThanOrEqual(0);
    }
  });

  it('§65 TOTAL: every step — auto-build, outbox and transactions included — costs the same round trips for 200 technicians as for 20', () => {
    for (const step of STEPS) {
      const a = small.results[step]!.counts, b = large.results[step]!.counts;
      // a small constant at most (a chunked multi-row write may add a round trip); nothing per technician
      expect(b.total - a.total, `${step}: ${a.total} round trips for 20 technicians, ${b.total} for 200`).toBeLessThanOrEqual(5);
      expect(b.autobuild - a.autobuild, `${step}: auto-build ${a.autobuild} → ${b.autobuild}`).toBeLessThanOrEqual(0);
    }
    // the build reads each fact kind once (sums, plan / ledger technicians, tier, pay plan, ledger, guarantee, clock, attendance)
    for (const step of ['calculate', 'submit', 'approve'] as const) expect(large.results[step]!.counts.autobuild, `${step} auto-build round trips`).toBeLessThanOrEqual(15);
    // submit validates once and hands that result to prepare — the auto-build is not dry-run a second time
    expect(large.results.submit!.counts.autobuild).toBeLessThanOrEqual(large.results.calculate!.counts.autobuild);
  });

  it('the outbox carries exactly one row per domain event (one per statement on create / plan, one per step otherwise)', () => {
    expect(large.results.calculate!.counts.outboxRows - small.results.calculate!.counts.outboxRows).toBe(180);   // payroll.pay_statement_created ×(200 − 20)
    expect(large.results.approve!.counts.outboxRows - small.results.approve!.counts.outboxRows).toBe(180);       // payroll.payout_planned ×(200 − 20)
    for (const step of ['periodStatements', 'applyDefaultToAll', 'submit', 'issueCheck'] as const) expect(large.results[step]!.counts.outboxRows).toBe(small.results[step]!.counts.outboxRows);
    // …written as multi-row inserts: the number of outbox round trips does not grow with the technician count
    for (const step of STEPS) expect(large.results[step]!.counts.outbox, step).toBe(small.results[step]!.counts.outbox);
  });
});

describe('the set-based paths keep the per-row semantics — recalculate, send back, reopen', () => {
  let s: Salon;
  const tech = (i: number) => uid(3, 10, i);
  const A = tech(1), B = tech(2), C = tech(4), D = tech(10);   // A manual %, B manual $, C default, D drops out of the week
  const stmt = async (t: string) => (await q(`select * from payroll_statements where tenant_id = $1 and period_id = $2 and technician_id = $3 and status <> 'voided'`, [s.tenantId, s.periodId, t]))[0];
  const live = async (statementId: unknown) => (await q(`select * from payroll_payout_plans where tenant_id = $1 and statement_id = $2 and status <> 'superseded'`, [s.tenantId, statementId]))[0];
  const instr = async (planId: unknown) => q(`select method, amount_cents, basis_points, sequence, status from payroll_payout_instructions where tenant_id = $1 and plan_id = $2 order by sequence`, [s.tenantId, planId]);
  beforeAll(async () => {
    s = await seedSalon(pg, 3, 12);
    await s.svc.calculate(managerCtx(s), s.periodId);
  }, 240_000);

  it('recalculation: changed figures are rewritten (version + 1), percent plans re-split, dollar plans keep their amounts, a technician without earnings is voided', async () => {
    const a0 = await stmt(A), b0 = await stmt(B), c0 = await stmt(C), d0 = await stmt(D), u0 = await stmt(tech(0));
    const pa = Number(a0.approved_payable_cents), pb = Number(b0.approved_payable_cents);
    await s.svc.setPayoutPlan(managerCtx(s), String(a0.id), { policyType: 'manual_percent', entries: [{ method: 'check', basisPoints: 7000 }, { method: 'cash', basisPoints: 3000 }], overrideReason: 'Prefers more on the check' });
    await s.svc.setPayoutPlan(managerCtx(s), String(b0.id), { policyType: 'manual_amount', entries: [{ method: 'check', amountCents: pb - 1000 }, { method: 'cash', amountCents: 1000 }], overrideReason: 'Only $10 cash' });
    const aPlan0 = await live(a0.id), bPlan0 = await live(b0.id), cPlan0 = await live(c0.id), dPlan0 = await live(d0.id), uPlan0 = await live(u0.id);
    const a1v = Number((await stmt(A)).version), b1v = Number((await stmt(B)).version);
    // the week changes: A, B and C get a $12.34 bonus; D's sales are gone
    for (const t of [A, B, C]) await q(`insert into compensation_adjustments (tenant_id, technician_id, period_id, category, amount_cents, reason_code, reason, status, source) values ($1,$2,$3,'bonus',1234,'manual_bonus','late bonus','approved','manual')`, [s.tenantId, t, s.periodId]);
    await q(`delete from ticket_compensation_snapshots where tenant_id = $1 and technician_id = $2`, [s.tenantId, D]);
    await s.svc.calculate(managerCtx(s), s.periodId);

    const a = await stmt(A), b = await stmt(B), c = await stmt(C), u = await stmt(tech(0));
    const lines = new Map((await q(`select technician_id, payable_cents from payroll_lines where tenant_id = $1 and period_id = $2`, [s.tenantId, s.periodId])).map((l) => [String(l.technician_id), Number(l.payable_cents)]));
    expect(Number(a.approved_payable_cents)).toBe(pa + 1234);
    expect(Number(b.approved_payable_cents)).toBe(pb + 1234);
    expect(Number(c.approved_payable_cents)).toBe(Number(c0.approved_payable_cents) + 1234);
    for (const x of [a, b, c]) { expect(Number(x.approved_payable_cents)).toBe(lines.get(String(x.technician_id))); expect(Number(x.bonus_cents)).toBeGreaterThanOrEqual(1234); }
    expect(Number(a.version)).toBe(a1v + 1);
    expect(Number(b.version)).toBe(b1v + 1);
    expect(Number(c.version)).toBe(Number(c0.version) + 1);
    expect(a.statement_number).toBe(a0.statement_number);   // same statement, same number
    expect(Array.isArray(a.branch_breakdown) ? a.branch_breakdown.length : 0).toBeGreaterThan(0);
    // unchanged technician: untouched (same version, same plan)
    expect(Number(u.version)).toBe(Number(u0.version));
    expect((await live(u.id)).id).toBe(uPlan0.id);
    // A: the percent plan is re-split exactly on the new payable — a new plan, still flagged as an override with its reason
    const aPlan = await live(a.id);
    expect(aPlan.id).not.toBe(aPlan0.id);
    expect(aPlan).toMatchObject({ policy_type: 'manual_percent', status: 'draft', differs_from_default: true, override_reason: 'Prefers more on the check' });
    const aIns = await instr(aPlan.id);
    expect(aIns.map((i) => [i.method, Number(i.basis_points), Number(i.sequence), i.status])).toEqual([['check', 7000, 1, 'planned'], ['cash', 3000, 2, 'planned']]);
    expect(aIns.reduce((t, i) => t + Number(i.amount_cents), 0)).toBe(pa + 1234);
    expect((await q(`select status from payroll_payout_plans where id = $1`, [aPlan0.id]))[0].status).toBe('superseded');
    expect((await instr(aPlan0.id)).every((i) => i.status === 'canceled')).toBe(true);
    // B: the dollar plan keeps what the manager typed (same plan, payable moved, version + 1) — never silently rescaled
    const bPlan = await live(b.id);
    expect(bPlan.id).toBe(bPlan0.id);
    expect(Number(bPlan.payable_cents)).toBe(pb + 1234);
    expect(Number(bPlan.version)).toBe(Number(bPlan0.version) + 1);
    expect((await instr(bPlan.id)).map((i) => Number(i.amount_cents))).toEqual([pb - 1000, 1000]);
    // C: a default plan is re-split 50 / 50 on the new payable
    const cPlan = await live(c.id);
    expect(cPlan.id).not.toBe(cPlan0.id);
    const cp = Number(c.approved_payable_cents);
    expect((await instr(cPlan.id)).map((i) => [i.method, Number(i.amount_cents)])).toEqual([['check', Math.ceil(cp / 2)], ['cash', Math.floor(cp / 2)]]);
    // D: voided (kept, never deleted), plan superseded, instructions canceled
    const d = (await q(`select status, void_reason, version from payroll_statements where id = $1`, [d0.id]))[0];
    expect(d).toMatchObject({ status: 'voided', void_reason: 'No earnings in this week any more' });
    expect(Number(d.version)).toBe(Number(d0.version) + 1);
    expect((await q(`select status from payroll_payout_plans where id = $1`, [dPlan0.id]))[0].status).toBe('superseded');
    expect((await instr(dPlan0.id)).every((i) => i.status === 'canceled')).toBe(true);
    expect(await stmt(D)).toBeUndefined();
    // the manager's dollar split no longer adds up → the list view flags it, submit refuses
    const view = await s.svc.periodStatements(managerCtx(s), s.periodId);
    expect(view.statements).toHaveLength(11);
    expect(view.statements.find((x) => x.technicianId === B)!.plan!.issues.length).toBeGreaterThan(0);
    await expect(s.svc.submit(managerCtx(s), s.periodId)).rejects.toMatchObject({ code: 'PAYROLL_SUBMIT_BLOCKED' });
  });

  it('send back: every submitted statement and plan returns to draft; reopen after an all-held approval voids the week', async () => {
    await s.svc.setPayoutPlan(managerCtx(s), String((await stmt(B)).id), { policyType: 'split_check_cash' });
    await s.svc.submit(managerCtx(s), s.periodId);
    expect((await q(`select count(*)::int n from payroll_statements where period_id = $1 and status = 'submitted'`, [s.periodId]))[0].n).toBe(11);
    expect((await q(`select count(*)::int n from payroll_payout_plans p join payroll_statements st on st.id = p.statement_id where st.period_id = $1 and p.status = 'submitted'`, [s.periodId]))[0].n).toBe(11);
    await s.svc.decide(ownerCtx(s), s.periodId, 'returned', { note: 'Look again' });
    expect((await q(`select status, count(*)::int n from payroll_statements where period_id = $1 and status <> 'voided' group by status`, [s.periodId]))).toEqual([{ status: 'draft', n: 11 }]);
    expect((await q(`select p.status, count(*)::int n from payroll_payout_plans p join payroll_statements st on st.id = p.statement_id where st.period_id = $1 and st.status <> 'voided' and p.status <> 'superseded' group by p.status`, [s.periodId]))).toEqual([{ status: 'draft', n: 11 }]);
    await s.svc.submit(managerCtx(s), s.periodId);
    const all = (await q(`select technician_id from payroll_statements where period_id = $1 and status <> 'voided'`, [s.periodId])).map((r) => String(r.technician_id));
    await s.svc.approve(ownerCtx(s), s.periodId, { holdTechnicianIds: all });
    expect((await q(`select status, count(*)::int n from payroll_statements where period_id = $1 and status <> 'voided' group by status`, [s.periodId]))).toEqual([{ status: 'held', n: 11 }]);
    expect((await q(`select count(*)::int n from payroll_payouts where period_id = $1`, [s.periodId]))[0].n).toBe(0);
    await s.wf.reopen(ownerCtx(s), s.periodId, { reason: 'Wrong week' });
    expect((await q(`select count(*)::int n from payroll_statements where period_id = $1 and status <> 'voided'`, [s.periodId]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from payroll_payout_plans p join payroll_statements st on st.id = p.statement_id where st.period_id = $1 and p.status <> 'superseded'`, [s.periodId]))[0].n).toBe(0);
    expect((await q(`select count(*)::int n from payroll_payout_instructions i join payroll_statements st on st.id = i.statement_id where st.period_id = $1 and i.status <> 'canceled'`, [s.periodId]))[0].n).toBe(0);
    expect((await q(`select status, payout_status from payroll_periods where id = $1`, [s.periodId]))[0]).toMatchObject({ status: 'draft', payout_status: 'none' });
    // the next calculation makes NEW statements with NEW numbers
    const again = await s.svc.calculate(managerCtx(s), s.periodId);
    expect(again.statements).toHaveLength(11);
    const voidedNumbers = new Set((await q(`select statement_number from payroll_statements where period_id = $1 and status = 'voided'`, [s.periodId])).map((r) => String(r.statement_number)));
    expect(again.statements.every((x) => !voidedNumbers.has(x.statementNumber))).toBe(true);
  });
});

describe('§65 the batch auto-build is the per-technician auto-build — same lines, constant round trips', () => {
  // A salon seeded with EVERY fact kind the build reads: tier plans (all-branches, branch-specific, another branch's,
  // unreadable bands), pay plans (salon-wide vs branch-specific hybrid), time clock punches + breaks + an open punch,
  // a technician guarantee and a branch-default guarantee prorated by attendance (weekly templates, blocked windows,
  // unworked shift rows), routed + unrouted + other-category ledger entries and a ledger-only technician.
  const TECHS = 60;
  let s: Salon;
  const tech = (i: number) => uid(4, 10, i);
  const ins = async (table: string, cols: string[], rows: unknown[][]) => {
    for (const r of rows) await q(`insert into ${table} (${cols.join(', ')}) values (${cols.map((_, k) => `$${k + 1}`).join(', ')})`, r);
  };
  beforeAll(async () => {
    s = await seedSalon(pg, 4, TECHS);
    const T = s.tenantId, B = s.branchId, B2 = s.branch2;
    const entire = JSON.stringify([{ uptoCents: 20_000, ratePercent: 40 }, { uptoCents: null, ratePercent: 55 }]);
    const marginal = JSON.stringify([{ uptoCents: 10_000, ratePercent: 45 }, { uptoCents: 30_000, ratePercent: 50 }, { uptoCents: null, ratePercent: 60 }]);
    const tiers: unknown[][] = [], plans: unknown[][] = [], shifts: unknown[][] = [], breaks: unknown[][] = [], scheds: unknown[][] = [], blocks: unknown[][] = [], adj: unknown[][] = [];
    for (let i = 0; i < TECHS; i++) {
      const t = tech(i), kind = i % 10;
      if (i % 6 === 1) tiers.push([T, null, t, 'entire', entire, '2026-01-01T00:00:00Z', null]);
      if (i % 12 === 1) tiers.push([T, B, t, 'marginal', marginal, '2026-03-01T00:00:00Z', null]);        // branch-specific wins on B
      if (i % 12 === 5) tiers.push([T, B2, t, 'marginal', marginal, '2026-03-01T00:00:00Z', null]);       // another branch's plan
      if (i % 12 === 9) tiers.push([T, null, t, 'entire', entire, '2026-01-01T00:00:00Z', '2026-10-01T00:00:00Z']);   // ended
      if (i === 13) tiers.push([T, null, t, 'entire', '[]', '2026-01-01T00:00:00Z', null]);              // unreadable → per-line
      if (kind === 0) {   // salon-wide commission plan + a B-only hybrid (wins for a technician whose branch is B)
        plans.push([T, null, t, 'commission', null, null, '2026-01-01']);
        plans.push([T, B, t, 'hybrid', 1_500, null, '2026-01-01']);
        shifts.push([T, B, t, '2026-10-15', '2026-10-15T14:00:00Z', '2026-10-15T20:30:00Z']);
      }
      if (kind === 6) {
        breaks.push([T, B, t, '2026-10-13T17:00:00Z', '2026-10-13T17:45:00Z']);
        shifts.push([T, B, t, '2026-10-16', '2026-10-16T13:00:00Z', null]);   // open punch: not paid, counted as open
      }
      if (kind === 9 || i % 7 === 0) {   // guarantee technicians: worked days, an unworked scheduled row, a template, a block
        shifts.push([T, B, t, '2026-10-13', '2026-10-13T14:00:00Z', '2026-10-13T22:00:00Z']);
        shifts.push([T, B, t, '2026-10-17', null, null]);
        for (const dow of [1, 2, 3, 4, 5]) scheds.push([T, B, t, dow, '09:00', '17:00', '12:00', '12:30', i % 3 !== 0]);
        blocks.push([T, B, t, '2026-10-14', '10:00', '12:00']);
      }
      if (i % 8 === 2) adj.push([T, t, null, 'manual', 2_500, 'manual_other', null, '2026-10-14T15:00:00Z', 'other']);       // unrouted, in window
      if (i % 8 === 4) adj.push([T, t, null, 'manual', 9_900, 'manual_other', null, '2026-10-25T15:00:00Z', 'other']);       // unrouted, next week
      if (i % 9 === 3) adj.push([T, t, s.periodId, 'manual', 1_100, 'manual_bonus', null, '2026-11-02T15:00:00Z', 'bonus']);   // routed here
    }
    adj.push([T, uid(4, 99, 1), s.periodId, 'manual', 4_000, 'manual_bonus', null, '2026-10-14T15:00:00Z', 'bonus']);           // ledger-only technician
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Ledger','Only','Ledger Only','active',true)`, [uid(4, 99, 1), T, B]);
    for (const r of tiers) await q(`insert into technician_tier_plans (tenant_id, branch_id, technician_id, mode, bands_json, effective_start, effective_end, status) values ($1,$2,$3,$4,$5::jsonb,$6,$7,'active')`, r);
    await ins('technician_pay_plans', ['tenant_id', 'branch_id', 'technician_id', 'pay_type', 'hourly_rate_cents', 'salary_cents_per_period', 'effective_start'], plans);
    await ins('technician_shifts', ['tenant_id', 'branch_id', 'technician_id', 'shift_date', 'start_time', 'end_time'], shifts);
    await ins('technician_breaks', ['tenant_id', 'branch_id', 'technician_id', 'started_at', 'ended_at'], breaks);
    await ins('technician_schedules', ['tenant_id', 'branch_id', 'technician_id', 'day_of_week', 'start_time', 'end_time', 'lunch_start_time', 'lunch_end_time', 'is_working'], scheds);
    await ins('technician_blocked_times', ['tenant_id', 'branch_id', 'technician_id', 'block_date', 'start_time', 'end_time'], blocks);
    for (const r of adj) await q(`insert into compensation_adjustments (tenant_id, technician_id, period_id, source, amount_cents, reason_code, deduction_type, created_at, category, reason, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'seed','approved')`, r);
    // a branch default guarantee for the annex, prorated by scheduled hours (the attendance facts decide the floor)
    await q(`insert into technician_guarantee_policies (tenant_id, branch_id, technician_id, guaranteed_cents, period, proration, effective_start, status) values ($1,$2,null,60000,'week','by_scheduled_hours','2026-01-01T00:00:00Z','active')`, [T, B2]);
  }, 240_000);

  it('identical lines (integer cents, every field) from the batch ports and the per-technician ports; the batch path is flat', async () => {
    const adapter = new PayrollAutoBuildAdapter(kyselyFor(s.meter.connection(pg)));
    const BATCH = new Set(['resolveTierPlans', 'payPlans', 'timeFactsForTechnicians', 'adjustmentBreakdowns', 'resolveGuarantees', 'periodFactsForTechnicians']);
    // the same adapter with every batch method hidden: the build falls back to the per-technician calls
    const single = new Proxy(adapter, { get: (target, prop, recv) => (typeof prop === 'string' && BATCH.has(prop) ? undefined : Reflect.get(target, prop, recv)) }) as AutoBuildPorts;
    const tz = await adapter.timezone(s.tenantId, null);
    const w = resolveEarningsWindow({ period: 'pay_period', timezone: tz, payPeriod: { id: s.periodId, periodStart: '2026-10-12', periodEnd: '2026-10-18' } });
    const args = { tenantId: s.tenantId, fromIso: w.fromIso, toIso: w.toIso, branchId: null, periodId: s.periodId, periodStart: '2026-10-12', periodEnd: '2026-10-18', timezone: tz };
    const run = async (ports: AutoBuildPorts) => { s.meter.reset(); const t0 = performance.now(); const lines = await autoBuildPeriod(ports, args); return { lines, ms: Math.round(performance.now() - t0), queries: s.meter.c.total }; };
    const one = await run(single);
    const many = await run(adapter);
    console.log(`\n── auto-build ${TECHS + 1} technicians (every fact kind): per-technician ${one.queries} round trips / ${one.ms} ms → batch ${many.queries} round trips / ${many.ms} ms\n`);
    const byTech = (xs: typeof one.lines) => [...xs].sort((a, b) => a.technicianId.localeCompare(b.technicianId));
    expect(byTech(many.lines)).toEqual(byTech(one.lines));
    expect(many.lines).toHaveLength(TECHS + 1);
    // the seed really exercises each fact kind (so the equality above is not vacuous)
    const L = many.lines;
    expect(L.filter((l) => l.payType === 'hybrid' && l.hourlyPayCents > 0 && l.serviceCommissionCents > 0).length).toBeGreaterThan(0);
    expect([10, 20, 30, 40, 50].map((i) => L.find((l) => l.technicianId === tech(i))!.payType)).toEqual(Array(5).fill('hybrid'));   // the B-only plan beats the salon-wide one
    expect(L.filter((l) => l.payType === 'hourly' && l.hourlyPayCents > 0).length).toBeGreaterThan(0);
    expect(L.filter((l) => l.guaranteeTopUpCents > 0).length).toBeGreaterThan(5);
    expect(L.filter((l) => l.adjustmentCents === 2_500).length).toBeGreaterThan(0);
    expect(L.find((l) => l.technicianId === uid(4, 99, 1))).toMatchObject({ bonusCents: 4_000, serviceCommissionCents: 0 });
    // the tiers changed commission for the tiered technicians (vs the per-line sum the snapshots carry)
    const sums = new Map((await q(`select technician_id, sum(tech_service_earnings_cents)::int as e from ticket_compensation_snapshots where tenant_id = $1 group by technician_id`, [s.tenantId])).map((r) => [String(r.technician_id), Number(r.e)]));
    expect(L.filter((l) => sums.has(l.technicianId) && l.payType === 'commission' && l.serviceCommissionCents !== sums.get(l.technicianId)).length).toBeGreaterThan(3);
    // round trips: the batch path is a small constant; the per-technician path grows with the salon
    expect(many.queries).toBeLessThanOrEqual(15);
    expect(one.queries).toBeGreaterThan(TECHS * 3);
  });
});
