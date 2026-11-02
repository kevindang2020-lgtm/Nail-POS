// commission-screen.pgtest — the Commission Report read model (Oct 30 2026) against the REAL schema, seeded to the photo:
// Vishal verma 27 services $1,831.00 / commission $238.80 / tips $323.00 / payout $561.80; CD T6805 1 / $50 / $20 / $10 /
// $30; totals $1,881.00 / $258.80 / $333.00 / $591.80, effective rate 13.8%. Plus: captured rates per line, a pending
// adjustment that does NOT count, a tip whose allocations do not add up, a payroll period paid short, a line with no
// technician — found by the read-only Discrepancy Review — search beyond the page, and another salon never seen.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CommissionScreenRepository } from './commission-screen.repository';

const P = 'fa7d0000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9'), U = id('e1'), CU = id('e2');
const VISHAL = id('c1'), CD = id('c3'), OTHER = id('c9'), GEL = id('d1'), PERIOD = id('d5');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'MANAGER', permissions: ['pos.reports.view', 'payroll.view'] };
let pg: any; let repo: CommissionScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','cm-a','CMA001','active'), ($2,'Other LLC','Other','cm-b','CMB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  for (const [tid, n, tenant, br, ph] of [[VISHAL, 'Vishal verma', T, B, '+18565557001'], [CD, 'CD T6805', T, B, '+18565557003'], [OTHER, 'Vishal Other', T2, BX, '+18565557001']])
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label, normalized_phone) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician',$5)`, [tid, tenant, br, n, ph]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'Mai','Le','Mai Le','+18565551234')`, [CU, T, B]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [id('d9'), T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,6800,'active')`, [GEL, T, B, id('d9')]);
  let n = 0;
  const line = async (tenant: string, br: string, tech: string | null, gross: number, earned: number, tip: number, rate: number, opts: { tipOnTicket?: number; number?: string } = {}) => {
    n++; const tk = id('f' + n), ln = id('9' + String(n).padStart(3, '0'));
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, tip_cents) values ($1,$2,$3,$4,'paid',$5, now() - interval '1 hour', $6)`, [tk, tenant, br, tenant === T ? CU : null, opts.number ?? `T-${2000 + n}`, opts.tipOnTicket ?? tip]).catch(async () =>
      q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Other','Guest','Other Guest') on conflict do nothing`, [id('e9'), tenant, br]).then(() =>
        q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, tip_cents) values ($1,$2,$3,$4,'paid',$5, now() - interval '1 hour', $6)`, [tk, tenant, br, id('e9'), opts.number ?? `T-${2000 + n}`, tip])));
    await q(`insert into ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, technician_id, service_id, engine_version, gross_price_cents, commissionable_cents, commission_type, commission_value, tech_service_earnings_cents, card_tip_cents, snapshot_at)
      values ($1,$2,$3,$4,$5,$6,'v1',$7,$7,'percent',$8,$9,$10, now() - interval '1 hour')`, [tenant, br, tk, ln, tech, tenant === T ? GEL : null, gross, rate, earned, tip]);
    if (tech && tip) await q(`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values ($1,$2,$3,$4,$5)`, [tenant, br, tk, tech, tip]);
    return tk;
  };
  await line(T, B, VISHAL, 6800, 885, 1200, 13, { tipOnTicket: 1700, number: 'T-2001' });   // the ticket's tip was $17 but only $12 is allocated
  for (let i = 0; i < 25; i++) await line(T, B, VISHAL, 6800, 885, 1200, 13);
  await line(T, B, VISHAL, 6300, 870, 1100, 13);
  await line(T, B, CD, 5000, 2000, 1000, 40);
  await line(T, B, null, 2000, 0, 0, 0);                                                     // a paid line nobody performed
  await line(T2, BX, OTHER, 99900, 9900, 9900, 10);                                           // another salon
  await q(`insert into compensation_adjustments (tenant_id, branch_id, technician_id, category, amount_cents, reason, status, source) values ($1,$2,$3,'commission',-5000,'refund review','pending','refund')`, [T, B, VISHAL]);
  await q(`insert into payroll_periods (id, tenant_id, branch_id, label, period_start, period_end, status, paid_at) values ($1,$2,$3,'Oct 1–15', current_date - 20, current_date - 5, 'draft', null)`, [PERIOD, T, B]);
  await q(`insert into payroll_lines (tenant_id, period_id, technician_id, technician_name, payable_cents) values ($1,$2,$3,'Vishal verma',50000)`, [T, PERIOD, VISHAL]);
  await q(`update payroll_periods set status = 'paid', paid_at = now() - interval '2 hours' where id = $1`, [PERIOD]).catch(async () => q(`update payroll_periods set status = 'finalized' where id = $1`, [PERIOD]).then(() => q(`update payroll_periods set status = 'paid', paid_at = now() - interval '2 hours' where id = $1`, [PERIOD])));
  await q(`insert into payroll_payouts (tenant_id, branch_id, period_id, technician_id, amount_cents, method, status, reference, paid_at) values ($1,$2,$3,$4,30000,'cash','paid','PAY-778', now() - interval '2 hours')`, [T, B, PERIOD, VISHAL]);
  repo = new CommissionScreenRepository(kyselyFor(pg) as never);
}, 180_000);

describe('Commission Report', () => {
  it('the five KPIs equal the photo, and the pending adjustment does not count', async () => {
    const k = (await repo.summary(ctx, { preset: 'month' })).kpis;
    expect(k).toMatchObject({ technicianCount: 2, lineCount: 28, serviceRevenueCents: 188100, commissionCents: 25880, tipsCents: 33300, payoutCents: 59180, averageRatePercent: 13.8, commissionAdjustmentCents: 0, paidCents: 30000 });
  });
  it('Payout by Technician: one row each, the photo\'s figures, sortable; search reaches lines (ticket, customer phone) and never another salon', async () => {
    const t = await repo.technicians(ctx, { preset: 'month' });
    expect(t.items.map((r) => [r.technicianName, r.serviceCount, r.serviceRevenueCents, r.commissionCents, r.effectiveRatePercent, r.tipsCents, r.payoutCents]))
      .toEqual([['Vishal verma', 27, 183100, 23880, 13, 32300, 56180], ['CD T6805', 1, 5000, 2000, 40, 1000, 3000]]);
    expect((await repo.technicians(ctx, { preset: 'month', sort: 'name' })).items.map((r) => r.technicianName)).toEqual(['CD T6805', 'Vishal verma']);
    expect((await repo.technicians(ctx, { preset: 'month', q: '(856) 555-7001' })).items.map((r) => [r.technicianName, r.matchedVia])).toEqual([['Vishal verma', 'technician']]);
    expect((await repo.technicians(ctx, { preset: 'month', q: 'T-2001' })).items.map((r) => [r.technicianName, r.matchedVia])).toEqual([['Vishal verma', 'line']]);
    expect((await repo.technicians(ctx, { preset: 'month', q: '856 555 1234' })).totalItems).toBe(2);
  });
  it('a technician\'s lines carry the captured rate, newest first, paged; tips show the share and the mismatch', async () => {
    const l = await repo.lines(ctx, VISHAL, { preset: 'month', pageSize: 10 });
    expect(l.totalItems).toBe(27); expect(l.totalPages).toBe(3);
    expect(l.items[0]).toMatchObject({ rateType: 'percent', rateValue: 13, service: 'Gel Manicure' });
    const tips = await repo.tips(ctx, VISHAL, { preset: 'month', pageSize: 50 });
    expect(tips.items.filter((x) => x.mismatch).map((x) => [x.ticketNumber, x.tipCents, x.ticketTipCents])).toEqual([['T-2001', 1200, 1700]]);
    expect((await repo.adjustments(ctx, VISHAL, { preset: 'month' })).items.map((a) => [a.amountCents, a.status, a.counted])).toEqual([[-5000, 'pending', false]]);
    await expect(repo.lines(ctx, OTHER, { preset: 'month' })).rejects.toBeTruthy();
  });
  it('Paid comes only from recorded payouts; the Discrepancy Review finds the short period, the tip and the line with no technician', async () => {
    const p = await repo.payouts(ctx, { preset: 'month' });
    expect(p.items.map((x) => [x.technician, x.amountCents, x.status, x.reference, x.payrollPeriod])).toEqual([['Vishal verma', 30000, 'paid', 'PAY-778', 'Oct 1–15']]);
    const d = await repo.discrepancies(ctx, { preset: 'month' });
    expect(d.counts).toMatchObject({ payout_mismatch: 1, tip_mismatch: 1, missing_technician: 1 });
    expect(d.items.find((x) => x.kind === 'payout_mismatch')).toMatchObject({ technician: 'Vishal verma', expected: 50000, recorded: 30000 });
    expect(d.items.find((x) => x.kind === 'tip_mismatch')).toMatchObject({ ticketNumber: 'T-2001', expected: 1700, recorded: 1200 });
  });
  it('no pay permission → refused', async () => {
    await expect(repo.summary({ ...ctx, role: 'FRONT_DESK', permissions: ['pos.checkin.view'] }, { preset: 'month' })).rejects.toBeTruthy();
  });
});
