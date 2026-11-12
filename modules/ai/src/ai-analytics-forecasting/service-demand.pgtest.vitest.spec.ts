// service-demand.pgtest — extras (AI Analytics Forecasting 21) on the REAL schema: service demand per category comes from what
// was performed AND paid (paid tickets' service lines; removed and retail lines, voided tickets, other branches and today left
// out), per salon-local paid day; a category with enough history is forecast with the validated engine, one without says so.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyServiceDemandSource, ServiceDemandForecastService } from './service-demand-forecast.service';

const id = (n: number) => 'a9216000-0000-4000-8000-' + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), CUS = id(10), TECH = id(20), MANI = id(30), PEDI = id(31), CAT_M = id(40), CAT_P = id(41), PROD = id(50);
const ctx = { tenantId: T, branchId: B, userId: id(99), role: 'OWNER', permissions: ['pos.ai_analytics.view'] };
let pg: any; let db: any; let n = 1000;

async function sale(o: { daysAgo: number; lines: { svc?: string; cat?: string | null; qty?: number; retail?: boolean; removed?: boolean; product?: boolean }[]; status?: string; branch?: string }) {
  const tid = id(++n);
  await pg.query(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tip_cents, tax_cents, total_cents, paid_at)
    VALUES ($1, $2, $3, $4, $5, 1000, 0, 0, 0, 1000, now() - make_interval(days => $6::int))`, [tid, T, o.branch ?? B, CUS, o.status ?? 'paid', o.daysAgo]);
  for (const l of o.lines) await pg.query(`INSERT INTO ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, category_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, quantity, line_kind, removed_at, product_id)
    VALUES ($1, $2, $3, $4, $5, 'x', $6, 1000, 30, 1000, $7, $8, $9, $10)`, [T, o.branch ?? B, tid, l.svc ?? MANI, TECH, l.cat ?? null, l.qty ?? 1, l.retail ? 'retail' : null, l.removed ? new Date() : null, l.product ? PROD : null]);
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`SET TIME ZONE 'UTC'`);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'S LLC', 'Svc', 'svc-demand-21', 'SVCDEM21', 'active');
    INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', 'America/New_York'), ('${B2}', '${T}', 'Other', 'active', 'America/New_York');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${CUS}', '${T}', '${B}', 'Ann', 'A', 'Ann A');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH}', '${T}', '${B}', 'Lisa', 'T', 'Lisa T', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT_M}', '${T}', '${B}', 'Manicure'), ('${CAT_P}', '${T}', '${B}', 'Pedicure');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes, status) VALUES ('${MANI}', '${T}', '${B}', '${CAT_M}', 'Gel Manicure', 3000, 30, 'active'), ('${PEDI}', '${T}', '${B}', '${CAT_P}', 'Spa Pedicure', 4000, 45, 'active');`);
  // Manicure: 30 days back to yesterday, 2 units a day (one line qty 2) + Saturdays… kept simple: 2/day; plus noise that must NOT count
  for (let d = 1; d <= 30; d++) await sale({ daysAgo: d, lines: [{ svc: MANI, qty: 2 }, { svc: MANI, retail: true }, { svc: MANI, removed: true }, { product: true }] });
  // Pedicure: only the last 5 days (not enough history) — via the checkout snapshot "Pedicure"
  for (let d = 1; d <= 5; d++) await sale({ daysAgo: d, lines: [{ svc: PEDI, cat: 'Pedicure' }] });
  // never counted: a voided ticket, another branch, and a sale today (today is not over)
  await sale({ daysAgo: 3, status: 'voided', lines: [{ svc: MANI, qty: 9 }] });
  await sale({ daysAgo: 3, branch: B2, lines: [{ svc: MANI, qty: 9 }] });
  await sale({ daysAgo: 0, lines: [{ svc: MANI, qty: 9 }] });
}, 180_000);

describe('Service demand forecasting (extras AI Analytics Forecasting 21)', () => {
  it('history = units performed on paid tickets per category and salon day; enough history → forecast, too little → said so', async () => {
    const f = await new ServiceDemandForecastService(new KyselyServiceDemandSource(db)).getServiceDemand(ctx, 7);
    expect(f).toMatchObject({ timeZone: 'America/New_York', horizonDays: 7, minimumHistoryDays: 14, basis: 'paid_ticket_service_lines_by_paid_day' });
    expect(f.categories.map((c) => c.category)).toEqual(['Manicure', 'Pedicure']);
    const m = f.categories[0];
    expect(m).toMatchObject({ status: 'forecast', historyUnits: 60, lastSaleDay: f.historyTo });
    expect(m.historyDays).toBeGreaterThanOrEqual(29);
    expect(m.horizon).toHaveLength(7);
    expect(m.horizon[0].date > f.historyTo).toBe(true);
    for (const h of m.horizon) { expect(h.point).toBeGreaterThanOrEqual(1.5); expect(h.point).toBeLessThanOrEqual(2.5); expect(h.upper).toBeGreaterThanOrEqual(h.point); }
    expect(m.forecastUnits).toBeCloseTo(m.horizon.reduce((a, h) => a + h.point, 0), 0);
    expect(f.categories[1]).toMatchObject({ category: 'Pedicure', status: 'insufficient_history', historyUnits: 5, historyDays: 5, forecastUnits: null, horizon: [] });
  });
  it('another branch sees only its own service history', async () => {
    const f = await new ServiceDemandForecastService(new KyselyServiceDemandSource(db)).getServiceDemand({ ...ctx, branchId: B2 }, 7);
    expect(f.categories).toEqual([expect.objectContaining({ category: 'Manicure', historyUnits: 9, status: 'insufficient_history' })]);
  });
  it('a horizon outside 1–30 days is refused with a code', async () => {
    await expect(new ServiceDemandForecastService(new KyselyServiceDemandSource(db)).getServiceDemand(ctx, 45)).rejects.toMatchObject({ status: 400 });
  });
});
