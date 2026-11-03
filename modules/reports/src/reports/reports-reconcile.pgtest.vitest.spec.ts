// reports-reconcile.pgtest — the POS Reports reconcile with the money that moved (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs at the end of the pilot day (4 paid tickets, $411.25 collected):
//   tips $10.00 (payroll paid $30.00 — a split payment's tip lives on the ticket, not on the card row), tax $0.00 (the
//   payments rows never carry tax), discounts $0.00 ($18.00 given), product sales $0.00 (a $12.00 retail sale), "service
//   sales" = everything collected (gift-card sale, tax, tips and surcharges included), card surcharge = only the split's,
//   and FABRICATED figures: tax rate 7.75 % (the salon's is 6.625 %), "stub (live MID not configured)" for a live
//   gateway, top discount reason "Promo", surcharge 3 %, an average wait of 12 min / longest 34 / peak "5–7 PM" /
//   10 min per technician with no wait data at all.
// The report now takes each PAID ticket's own figures once (its final totals, its lines, the payments' recorded
// surcharge, the compensation snapshot's tip allocation — the payroll authority), and says nothing it does not know.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyReportsRepository, presetRange } from './reports.kysely.repository';

const T = 'a8001000-0000-4000-8000-000000000001', B = 'a8001000-0000-4000-8000-000000000002';
const L = 'a8001000-0000-4000-8000-0000000000a1', M = 'a8001000-0000-4000-8000-0000000000a2', C = 'a8001000-0000-4000-8000-0000000000c1';
const T1 = 'a8001000-0000-4000-8000-0000000000e1', T2 = 'a8001000-0000-4000-8000-0000000000e2';
const P = 'a8001000-0000-4000-8000-0000000000f1', SVC = 'a8001000-0000-4000-8000-0000000000d1';
let pg: any; let repo: KyselyReportsRepository;
const ctx: any = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: [] };
// The report files a payment by date(created_at) in the DATABASE session's zone; the session is pinned to UTC below and
// 'today' is the database's own date (the test failed between 00:00 and 05:00 UTC on PGlite's GMT+5 default; wave 4 fix run).
let today = '';

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC'`);   // a production database session is UTC; the report's SQL and its rows then agree on the day
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Rep LLC', 'Rep Salon', 'rep-salon', 'REPSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${C}', '${T}', '${B}', 'Jen', 'W', 'Jen W');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${L}', '${T}', '${B}', 'Lisa', 'T', 'Lisa T', 'active'), ('${M}', '${T}', '${B}', 'Mary', 'N', 'Mary N', 'active');
    INSERT INTO inventory_products (id, tenant_id, name) VALUES ('${P}', '${T}', 'Cuticle Oil');
    INSERT INTO tenant_settings (tenant_id, branch_id, category, settings_json) VALUES ('${T}', '${B}', 'tax', '{"enabled":true,"taxRatePercent":6.625}'), ('${T}', '${B}', 'payments-checkout', '{"creditCardSurchargeEnabled":true,"creditCardSurchargePercent":3}');
    INSERT INTO tenant_payment_config (tenant_id, processor, status, environment) VALUES ('${T}', 'cardpointe', 'active', 'sandbox');
    -- ticket 1: gel $45 + retail oil $12, $6 discount, $10 tip, tax $3.38, paid by card (no surcharge recorded)
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at)
      VALUES ('${T1}', '${T}', '${B}', '${C}', 'paid', '${L}', 5100, 600, 1000, 338, 0, 6438, now());
    INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
      VALUES ('${T}', '${B}', '${T1}', '${SVC}', '${L}', 'Gel Manicure', 4500, 45, 4500);
    INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, product_id, line_kind, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
      VALUES ('${T}', '${B}', '${T1}', NULL, '${P}', 'retail', NULL, 'Cuticle Oil', 1200, 0, 1200);
    INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status) VALUES ('${T}', '${B}', '${T1}', 'card', 6438, 1000, 0, 'approved');
    -- ticket 2: pedicure $60 shared by Lisa + Mary, $20 tip, tax $3.98; gift card $50 + card with a $1.00 surcharge
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at)
      VALUES ('${T2}', '${T}', '${B}', '${C}', 'paid', '${L}', 6000, 0, 2000, 398, 100, 8498, now());
    INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
      VALUES ('${T}', '${B}', '${T2}', '${SVC}', '${M}', 'Spa Pedicure', 6000, 60, 6000);
    INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status) VALUES ('${T}', '${B}', '${T2}', 'gift_card', 5000, 0, 0, 'approved'), ('${T}', '${B}', '${T2}', 'card', 3498, 0, 100, 'approved');
  `);
  // the payroll authority's tip allocation (Ticket 2's $20 split 1000 / 1000)
  const snap = async (ticket: string, tech: string, tip: number) => pg.query(`INSERT INTO ticket_compensation_snapshots (tenant_id, branch_id, ticket_id, service_line_id, engine_version, technician_id, card_tip_cents, cash_tip_cents, gross_price_cents, tech_service_earnings_cents) VALUES ($1,$2,$3,gen_random_uuid(),'test',$4,$5,0,0,0)`, [T, B, ticket, tech, tip]).catch((e: any) => { throw new Error('snapshot fixture: ' + e.message); });
  await snap(T1, L, 1000); await snap(T2, L, 1000); await snap(T2, M, 1000);
  today = String((await pg.query(`select current_date::text as d`)).rows[0].d);
  repo = new KyselyReportsRepository(kyselyFor(pg) as any);
}, 180_000);

describe('POS Reports reconcile with the day', () => {
  it('sales KPIs: tax, tips, discounts, products and services from the paid tickets — once per ticket', async () => {
    const { state } = await repo.query(ctx, { from: today, to: today, preset: 'today' as any });
    const k = state.salesKpis;
    expect(k.taxCollectedCents).toBe(338 + 398);
    expect(k.tipsCents).toBe(3000);
    expect(k.discountsCents).toBe(600);
    expect(k.productSalesCents).toBe(1200);
    expect(k.serviceSalesCents).toBe(4500 + 6000);
    expect(k.grossSalesCents).toBe(4500 + 1200 + 6000);
    expect(k.cardSurchargeCents).toBe(100);
    expect(k.ticketsCount).toBe(2);
    // the payments mix is still what was collected
    expect(state.payments.cardCents + state.payments.giftCardCents + state.payments.cashCents).toBe(6438 + 8498);
  });
  it('tips by technician are the payroll allocation (split tips split), not "all to the primary technician"', async () => {
    const { state } = await repo.query(ctx, { from: today, to: today, preset: 'today' as any });
    const by = Object.fromEntries(state.tips.byTechnician.map((x: any) => [x.technicianId, x.tipsCents]));
    expect(by[L]).toBe(2000); expect(by[M]).toBe(1000);
  });
  it('no fabricated figures: the salon\'s tax rate and surcharge %, the gateway\'s real status, no invented waits', async () => {
    const { state } = await repo.query(ctx, { from: today, to: today, preset: 'today' as any });
    expect(state.tax.taxRatePercent).toBe(6.625);
    expect(state.discountSurcharge.surchargePercent).toBe(3);
    expect(state.discountSurcharge.topReason).not.toBe('Promo');
    expect(state.payments.processorStatus).toBe('active');
    expect(state.queue.averageWaitMinutes).toBe(0);
    expect(state.queue.longestWaitMinutes).toBe(0);
    expect(state.queue.peakWindow).toBe('');
    expect(state.queue.byTechnician).toEqual([]);
    // wave 4 PILOT screen pass: POS Reports showed "Average rating 4.8" with no reviews, a +11.1 % revenue trend against an
    // invented previous period (gross × 0.9), and 1 booking / 1 completed on every chart day
    expect(state.kpis.averageRating).toBe(0);
    expect(state.kpis.averageRatingDelta).toBe(0);
    expect(state.kpis.revenueTrendPercent).toBe(0);
    expect(state.revenueOverview.trendPercent).toBe(0);
    expect(state.kpis.bookingsTrendPercent).toBe(0);
    expect(state.appointmentsTrend.points.reduce((n: number, p: any) => n + p.completed, 0)).toBe(state.kpis.completedServices);
  });
  it('a preset without from/to is the period it names (before: always the last 7 days — "today", "month", "year" all alike)', async () => {
    await pg.exec(`UPDATE branches SET timezone = 'UTC' WHERE id = '${B}'`);   // the rows are filed by the UTC day (see above), so the salon's day must be too
    const all = (await repo.query(ctx, { from: today, to: today })).state.salesKpis;
    expect(all.ticketsCount).toBeGreaterThan(0);
    expect((await repo.query(ctx, { preset: 'today' } as any)).state.salesKpis.ticketsCount).toBe(all.ticketsCount);
    expect((await repo.query(ctx, { preset: 'yesterday' } as any)).state.salesKpis.ticketsCount).toBe(0);   // today's tickets are not yesterday's
  });
  it('presetRange: salon-local days, weeks from Monday, quarters, years', () => {
    const at = new Date('2026-11-04T03:00:00Z');   // still Nov 3 in New York
    expect(presetRange('today', at, 'America/New_York')).toEqual({ from: '2026-11-03', to: '2026-11-03' });
    expect(presetRange('yesterday', at, 'America/New_York')).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(presetRange('week', at, 'America/New_York')).toEqual({ from: '2026-11-02', to: '2026-11-03' });
    expect(presetRange('month', at, 'America/New_York')).toEqual({ from: '2026-11-01', to: '2026-11-03' });
    expect(presetRange('quarter', at, 'America/New_York')).toEqual({ from: '2026-10-01', to: '2026-11-03' });
    expect(presetRange('year', at, 'UTC')).toEqual({ from: '2026-01-01', to: '2026-11-04' });
  });
});
