// revenue-source-report.pgtest — extras (AI Analytics Forecasting 06), Source-to-Report on the REAL schema and the canonical
// Sales report (KyselyReportsRepository through ReportsService): the daily series the revenue forecast trains on adds up to the
// SAME report's gross sales for the same salon days; discounts and refunds are read from the report and shown beside, never
// subtracted or recomputed here. Read only.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyReportsRepository, ReportsService } from '@aipowersalon/reports';
import { ReportsRevenueSource } from './ai-analytics-forecasting.module';
import { ZeroFilledRevenueSource } from './forecast-history.kysely.source';
import { RevenueForecastService } from './revenue-forecast.service';

const id = (n: number) => 'a9206000-0000-4000-8000-' + String(n).padStart(12, '0');
const T = id(1), B = id(2), CUS = id(10), TECH = id(20), SVC = id(30), CAT = id(31);
const ctx = { tenantId: T, branchId: B, userId: id(99), role: 'OWNER', permissions: ['reports.view', 'pos.reports.view', 'pos.reports.financial_view'] };
let pg: any; let db: any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'F LLC', 'Forecast', 'fc-src-06', 'FCSRC06', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CUS}', '${T}', '${B}', 'Ann', 'A', 'Ann A');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH}', '${T}', '${B}', 'Lisa', 'T', 'Lisa T', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 4800, 45, 'active');`);
  // 20 salon days of paid tickets (one per day, $30 + $1 × day), one of them discounted $5
  for (let d = 2; d <= 21; d++) {
    const line = 3000 + d * 100, disc = d === 5 ? 500 : 0;
    await pg.exec(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, primary_technician_id, subtotal_cents, discount_cents, tip_cents, tax_cents, total_cents, paid_at)
      VALUES ('${id(100 + d)}', '${T}', '${B}', '${CUS}', 'paid', '${TECH}', ${line}, ${disc}, 0, 0, ${line - disc}, now() - interval '${d} days');
      INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
      VALUES ('${T}', '${B}', '${id(100 + d)}', '${SVC}', '${TECH}', 'Gel Manicure', ${line}, 45, ${line});
      INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at)
      VALUES ('${T}', '${B}', '${id(100 + d)}', 'card', ${line - disc}, 0, 'approved', now() - interval '${d} days');`);
  }
}, 180_000);

describe('Source-to-Report (extras AI Analytics Forecasting 06)', () => {
  it('the trained daily series adds up to the canonical report\'s gross sales for the same days; the forecast says so and reads the rest from the report', async () => {
    const reports = new ReportsService(new KyselyReportsRepository(db));
    const src = new ZeroFilledRevenueSource(new ReportsRevenueSource(reports), db);
    const pts = await src.getDailyRevenue(ctx, 180);
    expect(pts.length).toBeGreaterThanOrEqual(19);
    const trained = pts.reduce((a, p) => a + p.value, 0);
    const k = (await reports.getSales(ctx, { from: pts[0].date, to: pts[pts.length - 1].date })).kpis;
    expect(trained).toBe(k.grossSalesCents);
    const f = await new RevenueForecastService(src).getRevenueForecast(ctx, 7);
    expect(f.source).toMatchObject({ from: pts[0].date, to: pts[pts.length - 1].date, days: pts.length, trainedTotalCents: trained, status: 'matches', differenceCents: 0,
      report: { grossSalesCents: k.grossSalesCents, discountsCents: k.discountsCents, netSalesCents: k.netSalesCents, refundsCents: k.refundsCents, ticketsCount: k.ticketsCount } });
    expect(f.source!.report!.discountsCents).toBe(500);   // read from the report and shown beside — the trained series is NOT net of it
  });
  it('without the financial permission the reconciliation is never shown as numbers', async () => {
    const reports = new ReportsService(new KyselyReportsRepository(db));
    const src = new ZeroFilledRevenueSource(new ReportsRevenueSource(reports), db);
    await expect(new RevenueForecastService(src).getRevenueForecast({ ...ctx, permissions: ['reports.view'] }, 7)).rejects.toMatchObject({ status: 403 });
  });
});
