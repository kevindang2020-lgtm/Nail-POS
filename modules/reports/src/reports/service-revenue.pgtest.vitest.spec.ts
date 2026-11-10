// service-revenue.pgtest — SUNMI batch 9 guide 2 "Revenue by Service" (Nov 10 2026) on the REAL schema:
//   §11 a multi-service ticket splits by its own lines (not all under the first line's category); retail is not service
//   §10 units = quantity; historical name / category snapshots; tax, tip, surcharge never service revenue
//   §12 an unmapped line and a paid ticket with no lines stay visible, so the categories add up to Service Sales
//   §8–9 search (service / technician / customer / formatted phone / ticket #), category filter, newest-first paging
//   §21 another salon's lines never appear; customer names and phone search need the financial permission
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyReportsRepository } from './reports.kysely.repository';
import { ReportsService } from './reports.service';
import { NO_LINES, UNMAPPED } from './service-revenue';

const id = (n: number) => 'a9002000-0000-4000-8000-' + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(3), BX = id(4), ANN = id(10), BEA = id(11), XC = id(12), LISA = id(20), MAI = id(21), NAILS = id(31), SPA = id(32), MANI = id(40), PEDI = id(41), XS = id(42), GONE = id(43), PROD = id(44);
let svc: ReportsService; let pgRef: any;
const owner: any = { tenantId: T, branchId: B, userId: 'u', role: 'OWNER', permissions: ['pos.reports.view', 'pos.reports.financial_view', 'pos.reports.export'] };
const staff: any = { tenantId: T, branchId: B, userId: 'u2', role: 'STAFF', permissions: ['pos.reports.view'] };
// the last 3 salon days (an explicit range, so the tickets 10–30 hours old are in it on any weekday)
let week: any;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`SET TIME ZONE 'UTC'`);
  const d = (await pg.query(`select ((now() at time zone 'America/New_York')::date - 2)::text as f, (now() at time zone 'America/New_York')::date::text as t`)).rows[0] as any;
  week = { preset: 'custom', from: d.f, to: d.t };
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'S LLC', 'Svc', 'svc-b9', 'SVCB9', 'active'), ('${X}', 'X LLC', 'Other', 'svcx-b9', 'SVCXB9', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York'), ('${BX}', '${X}', 'Other', 'active', 'America/New_York');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) VALUES
      ('${ANN}', '${T}', '${B}', 'Ann', 'Nguyễn', 'Ann Nguyễn', '+17145550101'), ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B', '+17145550202'), ('${XC}', '${X}', '${BX}', 'Ann', 'Other', 'Ann Other', '+17145550101');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${LISA}', '${T}', '${B}', 'Lisa', 'T', 'Lisa T', 'active'), ('${MAI}', '${T}', '${B}', 'Mai', 'P', 'Mai P', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${NAILS}', '${T}', '${B}', 'Nails'), ('${SPA}', '${T}', '${B}', 'Spa');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES
      ('${MANI}', '${T}', '${B}', '${NAILS}', 'Gel Manicure', 9999, 45, 'active'), ('${PEDI}', '${T}', '${B}', '${SPA}', 'Spa Pedicure', 5000, 45, 'active');`);
  const ticket = async (n: number, cust: string, hoursAgo: number, num: number, sub: number, disc: number, tax: number, tip: number, sur: number, lines: [string | null, string, string | null, string | null, number, number, string | null][], tenant = T, br = B) => {
    const total = sub - disc + tax + tip + sur;
    await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, ticket_number, status, subtotal_cents, discount_cents, tip_cents, tax_cents, surcharge_cents, total_cents, paid_at)
      VALUES ('${id(n)}', '${tenant}', '${br}', '${cust}', ${num}, 'paid', ${sub}, ${disc}, ${tip}, ${tax}, ${sur}, ${total}, now() - interval '${hoursAgo} hours');
      INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, surcharge_cents, status, created_at)
      VALUES ('${tenant}', '${br}', '${id(n)}', 'card', ${total}, ${tip}, ${sur}, 'approved', now() - interval '${hoursAgo} hours');`);
    for (const [svcId, name, cat, tech, qty, amt, kind] of lines)
      await pg.exec(`INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, product_id, service_id, technician_id, service_name_snapshot, category_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, quantity, line_kind)
        VALUES ('${tenant}', '${br}', '${id(n)}', ${svcId === 'PRODUCT' ? `'${PROD}'` : 'null'}, ${svcId && svcId !== 'PRODUCT' ? `'${svcId}'` : 'null'}, ${tech ? `'${tech}'` : 'null'}, '${name}', ${cat ? `'${cat}'` : 'null'}, ${amt}, 45, ${amt}, ${qty}, ${kind ? `'${kind}'` : 'null'})`);
  };
  // T1 (oldest): Ann — a manicure (Nails, $45 recorded though the catalog now says $99.99) + a pedicure (Spa) + a retail bottle
  await ticket(100, ANN, 30, 5001, 9200, 500, 700, 1000, 155, [[MANI, 'Gel Manicure', 'Nails', LISA, 1, 4500, null], [PEDI, 'Spa Pedicure', 'Spa', MAI, 1, 4000, null], ['PRODUCT', 'Cuticle oil', null, null, 1, 700, 'retail']]);
  // T2: Bea — two manicures on one line (quantity 2) under the OLD name, plus an add-on whose service was since deleted from the catalog and has no category snapshot (unmapped)
  await ticket(101, BEA, 20, 5002, 9500, 0, 0, 0, 0, [[MANI, 'Classic Manicure', 'Nails', LISA, 2, 8000, null], [GONE, 'Nail art', null, LISA, 1, 1500, null]]);
  // T3 (newest): Ann — a paid ticket with NO lines (sales fall back to its payment)
  await ticket(102, ANN, 10, 5003, 3000, 0, 0, 0, 0, []);
  // another salon, same customer name and phone, identical service — never visible
  await ticket(900, XC, 5, 5001, 4500, 0, 0, 0, 0, [[XS, 'Gel Manicure', 'Nails', null, 1, 4500, null]], X, BX);
  pgRef = pg;
  svc = new ReportsService(new KyselyReportsRepository(kyselyFor(pg) as any));
}, 180_000);

describe('Revenue by Service — one shared line-level calculation', () => {
  it('splits a multi-service ticket by its lines, counts units, keeps retail / tax / tip / surcharge out', async () => {
    const r = await svc.getServiceRevenue(owner, week);
    const byKey = Object.fromEntries(r.categories.map((c) => [c.key, c]));
    expect(byKey.Nails).toMatchObject({ grossCents: 12500, units: 3 });        // 4500 + 8000 (qty 2) — the RECORDED amounts
    expect(byKey.Spa).toMatchObject({ grossCents: 4000, units: 1 });           // used to be lumped under the first line's category
    expect(byKey[UNMAPPED]).toMatchObject({ grossCents: 1500, unmapped: true });
    expect(byKey[NO_LINES]).toMatchObject({ grossCents: 3000, units: 0 });
    expect(r.categories.map((c) => c.key)).toEqual(['Nails', 'Spa', NO_LINES, UNMAPPED]);   // revenue desc
    expect(r.totals).toMatchObject({ grossCents: 21000, units: 5, tickets: 3, ticketDiscountCents: 500 });
    expect(r.history.items.find((l) => l.serviceName === 'Classic Manicure')).toBeTruthy();   // historical name survives a rename
  });
  it('the categories add up to the Daily Summary Service Sales card, and the card uses the same ranking', async () => {
    const { state } = await (svc as any).repo.query(owner, week);
    expect(state.salesKpis.serviceSalesCents).toBe(21000);
    expect(state.revenueByService.map((x: any) => [x.serviceId, x.revenueCents])).toEqual([['Nails', 12500], ['Spa', 4000], [NO_LINES, 3000], [UNMAPPED, 1500]]);
  });
  it('history is newest first and pages without gaps or duplicates; totals cover every match', async () => {
    const r = await svc.getServiceRevenue(owner, week, { pageSize: 25 });
    expect(r.history.items.map((l) => l.ticketNumber)).toEqual(['5003', '5002', '5002', '5001', '5001']);
    expect(r.history.total).toBe(5);
    const nails = await svc.getServiceRevenue(owner, week, { category: 'Nails' });
    expect(nails.totals.grossCents).toBe(12500);
    expect(nails.categories).toHaveLength(4);                                 // the other bars stay visible
    const p = await svc.getServiceRevenue(owner, week, { page: 99 });
    expect(p.history.page).toBe(1);                                           // clamped
  });
  it('searches service, technician, customer (accent-free), a formatted phone and a ticket number', async () => {
    expect((await svc.getServiceRevenue(owner, week, { q: 'pedicure' })).totals.grossCents).toBe(4000);
    expect((await svc.getServiceRevenue(owner, week, { q: 'mai' })).totals.grossCents).toBe(4000);
    expect((await svc.getServiceRevenue(owner, week, { q: 'nguyen' })).totals.tickets).toBe(2);
    expect((await svc.getServiceRevenue(owner, week, { q: '(714) 555-0202' })).totals.grossCents).toBe(9500);
    expect((await svc.getServiceRevenue(owner, week, { q: '5003' })).totals.grossCents).toBe(3000);
  });
  it('never shows another salon; without the financial permission no customer names and no phone matching', async () => {
    const r = await svc.getServiceRevenue(owner, week, { q: 'other' });
    expect(r.history.total).toBe(0);
    const s = await svc.getServiceRevenue(staff, week);
    expect(s.customersVisible).toBe(false);
    expect(s.history.items.every((l) => l.customer === '')).toBe(true);
    expect((await svc.getServiceRevenue(staff, week, { q: '(714) 555-0202' })).history.total).toBe(0);
    expect(JSON.stringify(s)).not.toContain('5550202');
  });
  it('export is the WHOLE filtered set (not one page), CSV-safe, never the phone', async () => {
    const x = await svc.export(owner, 'service_lines', 'csv', week, { category: 'Nails' });
    const rows = x.csv!.split('\n');
    expect(rows[0]).toBe('Paid at (UTC),Ticket,Service,Category,Technician,Customer,Units,Sales before discounts (cents)');
    expect(rows).toHaveLength(3);                                             // header + the two Nails lines
    expect(x.csv).not.toContain('5550101');
    await expect(svc.export(staff, 'service_lines', 'csv', week)).rejects.toThrow(/export/);
  });
  it('the trend (guide 3): every bucket of the period, bucket sums = the Total Revenue and Appointments cards; compare is honest', async () => {
    const { state } = await (svc as any).repo.query(owner, { ...week, compare: true });
    const days = Math.round((Date.parse(state.dateRange.to) - Date.parse(state.dateRange.from)) / 86400000) + 1;
    expect(state.trend.buckets.map((b: any) => b.from)[0]).toBe(state.dateRange.from);
    expect(state.trend.buckets.length).toBe(state.trend.groupBy === 'hour' ? 24 : days);
    expect(state.trend.totalRevenueCents).toBe(state.salesKpis.grossSalesCents);
    expect(state.trend.totalTickets).toBe(state.salesKpis.ticketsCount);
    expect(state.trend.compare).toMatchObject({ revenueCents: 0, tickets: 0, revenueChangePercent: null });   // nothing last week
    expect(state.dateRange.timezone).toBe('America/New_York');
  });
  it('Sales Report ticket explorer (guide 4): one row per paid ticket, each money part separate, both technicians, newest first', async () => {
    const r = await svc.getTicketsPage(owner, week);
    expect(r.items.map((t) => t.ticketNumber)).toEqual(['5003', '5002', '5001']);
    const t1 = r.items.find((t) => t.ticketNumber === '5001')!;
    expect(t1).toMatchObject({ salesCents: 9200, discountCents: 500, netCents: 8700, taxCents: 700, tipCents: 1000, surchargeCents: 155, chargedCents: 10555, status: 'paid', methods: ['card'] });
    expect(t1.services).toEqual(['Gel Manicure', 'Spa Pedicure']); expect(t1.technicians).toEqual(['Lisa T', 'Mai P']);
    expect((await svc.getTicketsPage(owner, week, '714.555.0202')).items.map((t) => t.ticketNumber)).toEqual(['5002']);
    expect(JSON.stringify(r)).not.toContain('5550101');
    await expect(svc.getTicketsPage(staff, week)).rejects.toThrow();
    const { state } = await (svc as any).repo.query(owner, week);
    expect(state.salesKpis.customersCount).toBe(2);   // Ann + Bea — known customers of paid tickets only
  });
  it('Technicians (guide 6): each technician owns only their own lines; a helper is credited; buckets keep the total', async () => {
    const { state } = await (svc as any).repo.query(owner, week);
    const rows = state.topTechnicians.map((t: any) => [t.rank, t.name || t.technicianId, t.revenueCents, t.completedServices, t.tickets]);
    expect(rows).toEqual([[1, 'Lisa T', 14000, 4, 2], [2, 'Mai P', 4000, 1, 1], [0, '__no_lines__', 3000, 0, 1]]);
    expect(state.topTechnicians.reduce((s: number, t: any) => s + t.revenueCents, 0)).toBe(state.salesKpis.serviceSalesCents);
    const mai = await svc.getServiceRevenue(owner, week, { technician: MAI });
    expect(mai.totals).toMatchObject({ grossCents: 4000, units: 1 });
    expect(mai.history.items.map((l) => l.serviceName)).toEqual(['Spa Pedicure']);
  });
  it('Services Report (guide 10): ranked by service too — a renamed service stays one row; unique services is distinct services', async () => {
    const r = await svc.getServiceRevenue(owner, week);
    expect(r.totals.uniqueServices).toBe(3);                                  // manicure (renamed, one id), pedicure, nail art
    expect(r.services!.map((x) => [x.name, x.units, x.grossCents])).toEqual([['Classic Manicure', 3, 12500], ['Spa Pedicure', 1, 4000], ['Nail art', 1, 1500], ['', 0, 3000]]);
    const mani = await svc.getServiceRevenue(owner, week, { service: 'id:' + MANI });
    expect(mani.totals).toMatchObject({ grossCents: 12500, units: 3, uniqueServices: 1 });
  });
  it('Tax (guide 15, runs LAST — it flags a line exempt): taxable vs exempt from each line, retail its own category, no per-category tax', async () => {
    await pgRef.exec(`UPDATE ticket_service_lines SET is_taxable = false WHERE tenant_id = '${T}' AND service_name_snapshot = 'Nail art'`);
    const { state } = await (svc as any).repo.query(owner, week);
    expect(state.tax).toMatchObject({ taxableSalesCents: 17200, exemptSalesCents: 1500, adjustmentsCents: null, basis: 'lines_before_discounts' });   // 4500+4000+700+8000 | 1500
    expect(state.tax.byCategory.find((c: any) => c.category === 'Retail')).toMatchObject({ taxableCents: 700, taxCents: null });
    expect(state.tax.effectiveRatePercent).toBeCloseTo((700 / 17200) * 100, 2);
  });
});

