// merge-pay-compensation.pgtest — merge Oct 12 2026 (other chat's Technician Profile phase 2 compensation hunks + Payroll
// mandate) on the REAL schema (PGlite, all migrations). Pins:
//   • commission precedence (rule → service rate → tenant default), stamped with policy_id / rule_source (587), never null;
//   • refund reversals are POSTED, pro-rata without lines, IDEMPOTENT per refund payment (588) — history preserved;
//   • period earnings include posted reversals over a HALF-OPEN window; the snapshot carries rule_source;
//   • the ONE tip store: an explicit manual allocation governs the payment-time snapshot; on a PAID ticket it becomes a
//     posted tip_correction delta (Σ 0) — the snapshot is never edited; tips split card/cash from the payment rows.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCompensationPorts } from './compensation.kysely.ports';
import { CompensationService } from './compensation.service';
import { CompensationSnapshotRepository } from './compensation-snapshot.repository';
import { KyselyCompensationRulesRepo } from './compensation-rules.repository';
import { resolveLineCommissionWithDefault, stampCommissionOnLine, defaultCommissionForTenant, RULE_SOURCE_TENANT_DEFAULT, RULE_SOURCE_SERVICE_DEFAULT } from './compensation-rule-loader';
import { TipAllocationService } from './compensation-tip-allocation.service';
import { KyselyCommissionReportRepository } from '../commission-report/commission-report.kysely.repository';
import { buildCommissionReport } from '../commission-report/commission-report.dto';

const P = 'c0ec0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), CUST = id('c0'), TECH = id('c1'), TECH2 = id('c2'), CAT = id('ca1'), SVC_NONE = id('d1'), SVC_RATE = id('d2');
const quiet = { warn: () => undefined, error: () => undefined };
let pg: any; let db: any; let svc: CompensationService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = () => ({ tenantId: TA, branchId: BA });

async function paidTicket(tag: string, lines: { id: string; total: number; rate: number; tech?: string }[], tipCents = 0, chosen = 'card') {
  const ticket = id(tag);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents, tip_cents, paid_at, chosen_payment_method) values ($1,$2,$3,$4,'paid',$5,10000,10000,$6, now(), $7)`, [ticket, TA, BA, CUST, tag, tipCents, chosen]);
  for (const l of lines) {
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,'Gel',5000,45,$7,'percent',$8)`, [l.id, TA, BA, ticket, SVC_RATE, l.tech ?? TECH, l.total, l.rate]);
  }
  const r = await svc.snapshotPaidTicket(ctx(), ticket);
  expect(r.ok).toBe(true);
  return ticket;
}
const sumAdj = async (ticket: string, cat?: string) => Number((await q(`select coalesce(sum(amount_cents),0)::bigint as s from compensation_adjustments where ticket_id = $1 ${cat ? `and category = '${cat}'` : ''}`, [ticket]))[0].s);
const countAdj = async (ticket: string) => Number((await q(`select count(*)::int as n from compensation_adjustments where ticket_id = $1`, [ticket]))[0].n);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status, default_commission_percent) values ($1,'Pay Merge LLC','Pay Merge','pay-merge','PAYM01','active',45), ($2,'Other LLC','Other','pay-other','PAYM02','active',null)`, [TA, TB]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [BA, TA]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ann','Guest','Ann Guest')`, [CUST, TA, BA]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$3,$4,'Mia','Chen','Mia Chen','active',true), ($2,$3,$4,'Ava','L','Ava L','active',true)`, [TECH, TECH2, TA, BA]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, TA, BA]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel',45,5000)`, [SVC_NONE, TA, BA, CAT]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value) values ($1,$2,$3,$4,'Pedi',60,7000,'percent',55)`, [SVC_RATE, TA, BA, CAT]);
  svc = new CompensationService(new KyselyCompensationPorts(db), quiet);
}, 180_000);

describe('commission precedence: rule → service rate → tenant default (mandate §11), stamped on the line (587)', () => {
  it('no rule, no service rate → the TENANT default (45), never null / $0; a tenant without one gets the platform 50', async () => {
    expect((await defaultCommissionForTenant(db, TA)).commissionValue).toBe(45);
    expect((await defaultCommissionForTenant(db, TB)).commissionValue).toBe(50);
    const got = await resolveLineCommissionWithDefault(db, { tenantId: TA, branchId: BA, technicianId: TECH, serviceId: SVC_NONE });
    expect(got).toMatchObject({ commissionType: 'percent', commissionValue: 45, policyId: null, source: RULE_SOURCE_TENANT_DEFAULT });
  });
  it('the service\'s own rate beats the tenant default', async () => {
    const got = await resolveLineCommissionWithDefault(db, { tenantId: TA, branchId: BA, technicianId: TECH, serviceId: SVC_RATE });
    expect(got).toMatchObject({ commissionValue: 55, policyId: null, source: RULE_SOURCE_SERVICE_DEFAULT });
  });
  it('an authored TECHNICIAN rule beats the service rate; technician+service beats the technician rule', async () => {
    const repo = new KyselyCompensationRulesRepo(db);
    const rctx = { tenantId: TA, branchId: null, userId: id('ee1') };
    const tech = await repo.createPolicy(rctx, { technicianId: TECH }, 'Mia 65', { commissionType: 'percent', commissionValue: 65, effectiveStart: new Date(Date.now() - 864e5).toISOString() });
    await repo.activateVersion(rctx, tech.versions[0].id);
    const a = await resolveLineCommissionWithDefault(db, { tenantId: TA, branchId: BA, technicianId: TECH, serviceId: SVC_RATE });
    expect(a).toMatchObject({ commissionValue: 65, policyId: tech.id });
    const ts = await repo.createPolicy(rctx, { technicianId: TECH, serviceId: SVC_RATE }, 'Mia pedi 70', { commissionType: 'percent', commissionValue: 70, effectiveStart: new Date(Date.now() - 864e5).toISOString() });
    await repo.activateVersion(rctx, ts.versions[0].id);
    const b = await resolveLineCommissionWithDefault(db, { tenantId: TA, branchId: BA, technicianId: TECH, serviceId: SVC_RATE });
    expect(b).toMatchObject({ commissionValue: 70, policyId: ts.id });
    const c = await resolveLineCommissionWithDefault(db, { tenantId: TA, branchId: BA, technicianId: TECH, serviceId: SVC_NONE });
    expect(c).toMatchObject({ commissionValue: 65, policyId: tech.id });
    // the other technician: no rule → service rate
    expect((await resolveLineCommissionWithDefault(db, { tenantId: TA, branchId: BA, technicianId: TECH2, serviceId: SVC_RATE })).commissionValue).toBe(55);
  });
  it('stampCommissionOnLine fills a NULL-snapshot line (rate + policy_id + rule_source) and never re-prices a priced line', async () => {
    const ticket = id('e1'); const lineId = id('f1');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status) values ($1,$2,$3,$4,'serving')`, [ticket, TA, BA, CUST]);
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,'Pedi',7000,60,7000)`, [lineId, TA, BA, ticket, SVC_RATE, TECH]);
    const stamped = await stampCommissionOnLine(db, TA, lineId);
    expect(stamped).toMatchObject({ commissionValue: 70 });
    const row = (await q(`select commission_value_snapshot, policy_id, rule_source from ticket_service_lines where id = $1`, [lineId]))[0];
    expect(Number(row.commission_value_snapshot)).toBe(70);
    expect(row.policy_id).toBe(stamped!.policyId);
    expect(row.rule_source).toBe(stamped!.source);
    await q(`update ticket_service_lines set commission_value_snapshot = 33, rule_source = 'frozen' where id = $1`, [lineId]);
    expect((await stampCommissionOnLine(db, TA, lineId))!.commissionValue).toBe(33);   // frozen: history never moves
    expect(Number((await q(`select commission_value_snapshot from ticket_service_lines where id = $1`, [lineId]))[0].commission_value_snapshot)).toBe(33);
    // a line that reaches PAYMENT with a NULL snapshot is priced by the ports (never snapshots at $0) and carries rule_source
    const t2 = id('e2'); const l2 = id('f2');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, paid_at) values ($1,$2,$3,$4,'paid', now())`, [t2, TA, BA, CUST]);
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,$6,'Gel',5000,45,5000)`, [l2, TA, BA, t2, SVC_NONE, TECH2]);
    expect((await svc.snapshotPaidTicket(ctx(), t2)).ok).toBe(true);
    const snap = (await q(`select tech_service_earnings_cents, commission_value, rule_source from ticket_compensation_snapshots where ticket_id = $1`, [t2]))[0];
    expect(Number(snap.tech_service_earnings_cents)).toBe(2250);   // 45% tenant default of $50 — not $0
    expect(snap.rule_source).toBe(RULE_SOURCE_TENANT_DEFAULT);
  });
});

describe('refund reversal on the real schema (mandate §51–§54, §115)', () => {
  it('FULL refund reverses every line\'s commission (and the tip when refunded) as POSTED negative rows; the snapshot is untouched', async () => {
    const ticket = await paidTicket('a001', [{ id: id('f001'), total: 10000, rate: 60 }, { id: id('f002'), total: 5000, rate: 50 }], 1500);
    const r = await svc.reverseForRefund(ctx(), ticket, { type: 'full', tipRefunded: true, refundPaymentId: id('ab01') }, { reason: 'full refund', requestedBy: null });
    expect(r.ok).toBe(true);
    expect(await sumAdj(ticket, 'refund_reversal')).toBe(-(6000 + 2500));
    expect(await sumAdj(ticket, 'tip_correction')).toBe(-1500);
    expect((await q(`select distinct status from compensation_adjustments where ticket_id = $1`, [ticket])).map((s: any) => s.status)).toEqual(['posted']);
    expect(Number((await q(`select sum(tech_service_earnings_cents)::bigint as s from ticket_compensation_snapshots where ticket_id = $1`, [ticket]))[0].s)).toBe(8500);
  });
  it('IDEMPOTENT: replaying the same refund inserts nothing — commission is never reversed twice (588); a DIFFERENT refund still lands', async () => {
    const ticket = id('a001');
    const before = await countAdj(ticket); const sumBefore = await sumAdj(ticket);
    const r = await svc.reverseForRefund(ctx(), ticket, { type: 'full', tipRefunded: true, refundPaymentId: id('ab01') }, { reason: 'replayed hook', requestedBy: null });
    expect(r.ok).toBe(true); expect(r.entries).toBe(0);
    expect(await countAdj(ticket)).toBe(before); expect(await sumAdj(ticket)).toBe(sumBefore);
    const r2 = await svc.reverseForRefund(ctx(), ticket, { type: 'partial', lines: [{ serviceLineId: id('f002') }], refundPaymentId: id('ab02') }, { reason: 'second refund', requestedBy: null });
    expect(r2.entries).toBe(1);
  });
  it('PARTIAL by line reverses exactly the named line, whole; PARTIAL without lines reverses PRO-RATA, exact cents', async () => {
    const t1 = await paidTicket('a002', [{ id: id('f003'), total: 10000, rate: 60 }, { id: id('f004'), total: 5000, rate: 50 }]);
    await svc.reverseForRefund(ctx(), t1, { type: 'partial', lines: [{ serviceLineId: id('f004') }], refundPaymentId: id('ab03') }, { reason: 'redo', requestedBy: null });
    const rows = await q(`select service_line_id, amount_cents from compensation_adjustments where ticket_id = $1`, [t1]);
    expect(rows).toHaveLength(1); expect(rows[0].service_line_id).toBe(id('f004')); expect(Number(rows[0].amount_cents)).toBe(-2500);
    const t2 = await paidTicket('a003', [{ id: id('f005'), total: 10000, rate: 60 }, { id: id('f006'), total: 5000, rate: 50 }]);
    // $150 captured, $30 refunded → 20% of (6000 + 2500) = 1700, split 1200 / 500
    await svc.reverseForRefund(ctx(), t2, { type: 'partial', refundedCents: 3000, capturedCents: 15000, refundPaymentId: id('ab04') }, { reason: 'goodwill', requestedBy: null });
    expect((await q(`select amount_cents from compensation_adjustments where ticket_id = $1 order by service_line_id`, [t2])).map((r: any) => Number(r.amount_cents))).toEqual([-1200, -500]);
    expect(await sumAdj(t2)).toBe(-1700);
  });
  it('period earnings INCLUDE posted reversals over a HALF-OPEN window — a refunded ticket is not still shown as earned', async () => {
    const repo = new CompensationSnapshotRepository(db);
    const from = new Date(Date.now() - 3600_000).toISOString(); const to = new Date(Date.now() + 3600_000).toISOString();
    const sums = await repo.sumByTechnicianPeriod(TA, TECH, from, to);
    expect(sums.techServiceEarningsCents).toBe(8500 * 3);
    expect(sums.adjustmentsCents).toBe(-8500 - 2500 - 2500 - 1700);
    expect(sums.cardTipCents).toBe(0);   // the $15 tip was reversed
    const lines = await repo.linesByTechnicianPeriod(TA, TECH, from, to);
    expect(lines.length).toBe(6); expect(lines[0].serviceName).toBe('Gel');
    // half-open: a window that ENDS exactly at the snapshot instant excludes it
    const at = (await q(`select snapshot_at from ticket_compensation_snapshots where ticket_id = $1 limit 1`, [id('a001')]))[0].snapshot_at;
    const upto = new Date(at).toISOString();
    expect((await repo.sumByTechnicianPeriod(TA, TECH, from, upto)).tickets).toBeLessThan(sums.tickets);
    expect((await repo.sumByTechnicianPeriod(TA, TECH, upto, to)).tickets + (await repo.sumByTechnicianPeriod(TA, TECH, from, upto)).tickets).toBe(sums.tickets);
  });
  // Oct 13 2026 (FLOW duplicate D3/D4/D5): the branch-scoped sum is the ONE read behind the Live Technician Schedule
  // detail, the POS team list and the owner analytics — a snapshot at another location never leaks into this one.
  it('sumByTechnicianPeriod with a branchId counts only that location\'s snapshots and adjustments; without it, all of them', async () => {
    const repo = new CompensationSnapshotRepository(db);
    const BB = id('bb'); const T2 = id('a0b2');
    await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Second','active','America/New_York')`, [BB, TA]);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, subtotal_cents, total_cents, tip_cents, paid_at, chosen_payment_method) values ($1,$2,$3,$4,'paid','b2tk',6000,6000,500, now(), 'cash')`, [T2, TA, BB, CUST]);
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$2,$3,$4,$5,$6,'Pedi',6000,60,6000,'percent',50)`, [id('b2e1'), TA, BB, T2, SVC_RATE, TECH]);
    expect((await svc.snapshotPaidTicket({ tenantId: TA, branchId: BB }, T2)).ok).toBe(true);
    const from = new Date(Date.now() - 3600_000).toISOString(); const to = new Date(Date.now() + 3600_000).toISOString();
    const all = await repo.sumByTechnicianPeriod(TA, TECH, from, to);
    const second = await repo.sumByTechnicianPeriod(TA, TECH, from, to, BB);
    const main = await repo.sumByTechnicianPeriod(TA, TECH, from, to, BA);
    expect(second).toMatchObject({ techServiceEarningsCents: 3000, cashTipCents: 500, grossServiceCents: 6000, tickets: 1, adjustmentsCents: 0 });
    expect(main.techServiceEarningsCents + second.techServiceEarningsCents).toBe(all.techServiceEarningsCents);
    expect(main.adjustmentsCents).toBe(all.adjustmentsCents);   // every reversal so far was at the main branch
    expect(main.tickets + second.tickets).toBe(all.tickets);
    // the per-technician map the POS team list / owner analytics read (D4/D5): the same cents, reversals included
    const byTech = await repo.commissionByTechnician(TA, from, to);
    expect(byTech.get(TECH)?.commissionCents).toBe(all.techServiceEarningsCents + all.retailCommissionCents + all.adjustmentsCents);
    expect(byTech.get(TECH)?.tickets).toBe(all.tickets);
    expect((await repo.commissionByTechnician(TA, from, to, BB)).get(TECH)).toEqual({ commissionCents: 3000, tickets: 1, tipsCents: 500 });
    // ONE-PAY: the same map carries the technician's tips — the SAME tips the period read reports (card + cash + corrections)
    expect(byTech.get(TECH)?.tipsCents).toBe(all.cardTipCents + all.cashTipCents);
    expect((await repo.commissionByTechnician(TB, from, to)).size).toBe(0);   // another tenant sees nothing
    // D8: the Commission Report (same store) says the SAME commission as the snapshot sum — reversals included — over
    // the branch's civil day, not the UTC day
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const rep = new KyselyCommissionReportRepository(db);
    const src = await rep.load({ tenantId: TA, branchId: BA, userId: 'u', role: 'OWNER', permissions: [] } as any, day, day);
    const report = buildCommissionReport(src.lines, src.tipsByTech, src.techNames, src.adjustments);
    const mine = report.rows.find((r) => r.technicianId === TECH)!;
    expect(mine.commissionCents).toBe(main.techServiceEarningsCents + main.retailCommissionCents + main.adjustmentsCents);
    expect(mine.tipsCents).toBe(main.cardTipCents + main.cashTipCents);
  });
  it('the tenant review flag routes reversals to pending instead of posted', async () => {
    await q(`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values ($1, null, 'compensation', '{"refundReversalReview": true}'::jsonb)`, [TA]);
    const ticket = await paidTicket('a004', [{ id: id('f007'), total: 10000, rate: 60 }]);
    await svc.reverseForRefund(ctx(), ticket, { type: 'full', refundPaymentId: id('ab05') }, { reason: 'review me', requestedBy: null });
    expect((await q(`select status from compensation_adjustments where ticket_id = $1`, [ticket]))[0].status).toBe('pending');
    await q(`delete from tenant_settings where tenant_id = $1 and category = 'compensation'`, [TA]);
  });
});

describe('tips: the ONE store (mandate §22–§28), card/cash from payments (§29)', () => {
  it('two technicians, no explicit split → 50/50 with the odd cent to the stable first participant; card/cash follow the payment rows', async () => {
    const ticket = id('ef01');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, tip_cents, paid_at) values ($1,$2,$3,$4,'paid',2101, now())`, [ticket, TA, BA, CUST]);
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$3,$4,$5,$6,$7,'Gel',7000,45,7000,'percent',50), ($2,$3,$4,$5,$6,$8,'Pedi',3000,45,3000,'percent',50)`, [id('eb01'), id('eb02'), TA, BA, ticket, SVC_RATE, TECH, TECH2]);
    await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',5000,601,'approved'), ($1,$2,$3,'card',5000,1500,'approved')`, [TA, BA, ticket]);
    expect((await svc.snapshotPaidTicket(ctx(), ticket)).ok).toBe(true);
    const rows = await q(`select technician_id, card_tip_cents, cash_tip_cents from ticket_compensation_snapshots where ticket_id = $1 order by technician_id`, [ticket]);
    const tot = rows.map((r: any) => Number(r.card_tip_cents) + Number(r.cash_tip_cents)).sort((a: number, b: number) => b - a);
    expect(tot).toEqual([1051, 1050]);
    expect(rows.reduce((s: number, r: any) => s + Number(r.card_tip_cents), 0)).toBe(1500);
    expect(rows.reduce((s: number, r: any) => s + Number(r.cash_tip_cents), 0)).toBe(601);
    expect((await q(`select tip_cents from ticket_tip_allocations where ticket_id = $1`, [ticket])).map((r: any) => Number(r.tip_cents)).sort()).toEqual([1050, 1051]);
  });
  it('a manual explicit allocation on a PAID ticket writes posted tip_correction deltas (Σ 0) and the snapshot keeps its rows; the audit says who/why', async () => {
    const audits: any[] = [];
    const tips = new TipAllocationService(db, { record: async (_c: any, i: any) => { audits.push(i); return null; } } as any);
    const tctx = { tenantId: TA, branchId: BA, userId: id('ee1'), role: 'MANAGER', permissions: ['tips.adjust'] };
    const ticket = id('ef01');
    await expect(tips.allocate(tctx, ticket, { allocations: [{ technicianId: TECH, tipCents: 1500 }] })).rejects.toThrow(/total 1500 but the ticket tip is 2101/);
    await expect(tips.allocate(tctx, ticket, { allocations: [{ technicianId: id('c9'), tipCents: 2101 }] })).rejects.toThrow(/did not work this ticket/);
    const out = await tips.allocate(tctx, ticket, { allocations: [{ technicianId: TECH, tipCents: 1500 }, { technicianId: TECH2, tipCents: 601 }], reason: 'Customer said so' });
    expect(out.corrections).toBe(2);
    const corr = await q(`select technician_id, amount_cents, status, source, reason from compensation_adjustments where ticket_id = $1 and category = 'tip_correction' order by amount_cents`, [ticket]);
    expect(corr.map((c: any) => Number(c.amount_cents))).toEqual([-449, 449]);
    expect(corr.every((c: any) => c.status === 'posted' && c.source === 'manual' && c.reason === 'Customer said so')).toBe(true);
    expect((await q(`select sum(card_tip_cents + cash_tip_cents)::int as s from ticket_compensation_snapshots where ticket_id = $1`, [ticket]))[0].s).toBe(2101);   // untouched
    expect((await q(`select technician_id, tip_cents from ticket_tip_allocations where ticket_id = $1 order by tip_cents desc`, [ticket])).map((r: any) => [r.technician_id, Number(r.tip_cents)])).toEqual([[TECH, 1500], [TECH2, 601]]);
    // the same allocation again: no new delta (idempotent correction)
    expect((await tips.allocate(tctx, ticket, { allocations: [{ technicianId: TECH, tipCents: 1500 }, { technicianId: TECH2, tipCents: 601 }] })).corrections).toBe(0);
    expect(audits.filter((a) => a.action === 'ticket.tip_allocation_set').length).toBe(2);
    expect(audits[0].metadata).toMatchObject({ tipCents: 2101, paid: true, reason: 'Customer said so' });
    // the technician's period earnings reflect the correction (cardTipCents carries tip_correction)
    const repo = new CompensationSnapshotRepository(db);
    const sums = await repo.sumByTechnicianPeriod(TA, TECH2, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString());
    expect(sums.cardTipCents + sums.cashTipCents).toBe(601);
  });
  it('an explicit allocation recorded BEFORE payment governs the payment-time snapshot (§25 explicit split wins)', async () => {
    const ticket = id('ef02');
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, tip_cents) values ($1,$2,$3,$4,'service_done',2000)`, [ticket, TA, BA, CUST]);
    await q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, commission_type_snapshot, commission_value_snapshot) values ($1,$3,$4,$5,$6,$7,'Gel',7000,45,7000,'percent',50), ($2,$3,$4,$5,$6,$8,'Pedi',3000,45,3000,'percent',50)`, [id('eb03'), id('eb04'), TA, BA, ticket, SVC_RATE, TECH, TECH2]);
    const tips = new TipAllocationService(db);
    const out = await tips.allocate({ tenantId: TA, branchId: BA, userId: id('ee1'), role: 'MANAGER', permissions: [] }, ticket, { allocations: [{ technicianId: TECH, tipCents: 100 }, { technicianId: TECH2, tipCents: 1900 }] });
    expect(out.corrections).toBe(0);   // not paid: no ledger entry, the rows simply govern the snapshot
    await q(`update tickets set status = 'paid', paid_at = now() where id = $1`, [ticket]);
    expect((await svc.snapshotPaidTicket(ctx(), ticket)).ok).toBe(true);
    const rows = await q(`select technician_id, card_tip_cents + cash_tip_cents as tip from ticket_compensation_snapshots where ticket_id = $1`, [ticket]);
    expect(Object.fromEntries(rows.map((r: any) => [r.technician_id, Number(r.tip)]))).toEqual({ [TECH]: 100, [TECH2]: 1900 });
  });
});
