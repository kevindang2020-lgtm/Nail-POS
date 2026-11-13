// add-on-profitability.pgtest — Extras · ADD-ONS 09 "Service profitability context: optional authorized reporting on sold
// add-ons and consumed recipe cost with clearly defined basis", on the REAL migrated schema. Paid tickets in the salon-local
// window only; refunded / removed lines and tickets left out; recipe cost = units × THE recipe unit cost (the same function
// Menu Insights uses); no recipe → null, never 0, and kept out of the costed totals; other salons and branches never count.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AddOnProfitabilityReport, addOnProfitRow } from './add-on-profitability';
import { recipeUnitCosts } from './menu-insights.kysely.repository';

const id = (n: number) => `90090000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), X = id(2), B = id(3), B2 = id(4), BX = id(5), CAT = id(6), C = id(7);
const ART = id(11), PARA = id(12), CHROME = id(13), GEL = id(14), XART = id(15), CATX = id(9);
const P_GLUE = id(21), P_WAX = id(22);
let pg: any; let db: any; let rep: AddOnProfitabilityReport; let n = 100;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function ticket(o: { branch?: string; tenant?: string; paidDaysAgo?: number | null; status?: string; removed?: boolean; lines: { svc: string | null; name: string; cents: number; qty?: number; addOn?: boolean; removed?: boolean }[] }) {
  const tk = id(++n); const tenant = o.tenant ?? T; const branch = o.branch ?? B;
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents, paid_at, removed_at) values ($1,$2,$3,$4,$5,0,0, ${o.paidDaysAgo == null ? 'null' : `now() - interval '${o.paidDaysAgo} days'`}, ${o.removed ? 'now()' : 'null'})`,
    [tk, tenant, branch, tenant === T ? C : id(8), o.status ?? 'paid']);
  for (const l of o.lines) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, quantity, is_add_on, removed_at)
    values ($1,$2,$3,$4,$5,$6,10,$7,$8,$9, ${l.removed ? 'now()' : 'null'})`, [tenant, branch, tk, l.svc, l.name, l.cents, l.cents * (l.qty ?? 1), l.qty ?? 1, l.addOn ?? true]);
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); rep = new AddOnProfitabilityReport(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','ap-09','AP09','active'), ($2,'X','Other','ap-09x','AP09X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'North','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B2, BX, X]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'A','B','A B'), ($4,$5,$6,'X','Y','X Y')`, [C, T, B, id(8), X, BX]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Add-ons')`, [CAT, T, B]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values
    ($1,$5,$6,$7,'Nail Art',10,1500), ($2,$5,$6,$7,'Paraffin Dip',10,1000), ($3,$5,$6,$7,'Chrome',10,1200), ($4,$5,$6,$7,'Gel',45,5000)`, [ART, PARA, CHROME, GEL, T, B, CAT]);
  // glue has its own cost ($0.80); wax has none → the location average ($2.00 and $3.00 → $2.50)
  await q(`insert into inventory_products (id, tenant_id, name, sku, cost_cents) values ($1,$3,'Glue','G1',80), ($2,$3,'Wax','W1',null)`, [P_GLUE, P_WAX, T]);
  await q(`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand, average_cost_cents) values ($1,$2,$3,10,200), ($1,$4,$3,10,300)`, [T, B, P_WAX, B2]);
  // Nail Art uses 2 × glue = $1.60; Paraffin uses 1 × wax = $2.50; Chrome has NO recipe
  await q(`insert into service_product_recipes (tenant_id, service_id, product_id, quantity) values ($1,$2,$3,2), ($1,$4,$5,1)`, [T, ART, P_GLUE, PARA, P_WAX]);
  await ticket({ paidDaysAgo: 1, lines: [{ svc: GEL, name: 'Gel', cents: 5000, addOn: false }, { svc: ART, name: 'Nail Art', cents: 1500 }, { svc: CHROME, name: 'Chrome', cents: 1200 }] });
  await ticket({ paidDaysAgo: 3, lines: [{ svc: ART, name: 'Nail Art', cents: 1500, qty: 2 }, { svc: PARA, name: 'Paraffin Dip', cents: 1000 }] });
  // never counted: unpaid, refunded, removed ticket, removed line, outside the window, another branch, another salon
  await ticket({ paidDaysAgo: null, status: 'serving', lines: [{ svc: ART, name: 'Nail Art', cents: 1500 }] });
  await ticket({ paidDaysAgo: 1, status: 'refunded', lines: [{ svc: ART, name: 'Nail Art', cents: 1500 }] });
  await ticket({ paidDaysAgo: 1, removed: true, lines: [{ svc: ART, name: 'Nail Art', cents: 1500 }] });
  await ticket({ paidDaysAgo: 1, lines: [{ svc: PARA, name: 'Paraffin Dip', cents: 1000, removed: true }] });
  await ticket({ paidDaysAgo: 45, lines: [{ svc: PARA, name: 'Paraffin Dip', cents: 1000 }] });
  await ticket({ paidDaysAgo: 1, branch: B2, lines: [{ svc: PARA, name: 'Paraffin Dip', cents: 1000 }] });
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Add-ons')`, [CATX, X, BX]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Nail Art',10,9999)`, [XART, X, BX, CATX]);
  await ticket({ paidDaysAgo: 1, tenant: X, branch: BX, lines: [{ svc: XART, name: 'Nail Art', cents: 9999 }] });
}, 180_000);

describe('ADD-ONS 09 — add-on profitability with a stated basis', () => {
  it('sold add-ons on paid tickets in the window, recipe cost from THE recipe unit cost, the basis returned', async () => {
    const r = await rep.report({ tenantId: T, branchId: B }, { days: 30 });
    expect(r.basis).toEqual({ revenue: 'paid_tickets_line_totals', cost: 'recipe_at_current_product_cost', excludes: ['commission', 'tax', 'labor', 'refunded_or_voided_tickets'] });
    expect(r.window).toMatchObject({ days: 30, timeZone: 'America/New_York' });
    const by = Object.fromEntries(r.items.map((x) => [x.name, x]));
    expect(Object.keys(by).sort()).toEqual(['Chrome', 'Nail Art', 'Paraffin Dip']);   // the Gel base service is not an add-on
    expect(by['Nail Art']).toMatchObject({ unitsSold: 3, ticketCount: 2, revenueCents: 4500, recipeUnitCostCents: 160, recipeCostCents: 480, contributionCents: 4020 });
    expect(by['Paraffin Dip']).toMatchObject({ unitsSold: 1, revenueCents: 1000, recipeUnitCostCents: 250, recipeCostCents: 250, contributionCents: 750 });
    expect(by['Chrome']).toMatchObject({ revenueCents: 1200, recipeUnitCostCents: null, recipeCostCents: null, contributionCents: null });   // no recipe: "—", not 0
    expect(r.totals).toEqual({ unitsSold: 5, revenueCents: 6700, costedRevenueCents: 5500, recipeCostCents: 730, contributionCents: 4770, addOnsWithoutRecipe: 1 });
    // the same unit cost Menu Insights uses (one function)
    expect((await recipeUnitCosts(db, T, [ART, PARA])).get(ART)).toBe(160);
  });

  it('window, branch and salon scope; paging keeps the totals for the whole window', async () => {
    expect((await rep.report({ tenantId: T, branchId: B }, { days: 90 })).items.find((x) => x.name === 'Paraffin Dip')!.unitsSold).toBe(2);   // + the 45-day-old one
    expect((await rep.report({ tenantId: T, branchId: B2 }, { days: 30 })).items.map((x) => x.name)).toEqual(['Paraffin Dip']);
    expect((await rep.report({ tenantId: T, branchId: null }, { days: 30 })).items.find((x) => x.name === 'Paraffin Dip')!.unitsSold).toBe(2);   // salon-wide
    expect((await rep.report({ tenantId: X, branchId: BX }, { days: 30 })).items.map((x) => x.revenueCents)).toEqual([9999]);
    const p2 = await rep.report({ tenantId: T, branchId: B }, { days: 30, page: 2, pageSize: 2 });
    expect(p2).toMatchObject({ page: 2, totalItems: 3, totalPages: 2 });
    expect(p2.items).toHaveLength(1);
    expect(p2.totals.revenueCents).toBe(6700);
    expect((await rep.report({ tenantId: T, branchId: B }, { days: 12345 })).window.days).toBe(30);   // only the offered windows
  });

  it('pure row: contribution only with a recipe', () => {
    expect(addOnProfitRow({ key: 'k', serviceId: 's', name: 'N', units: 2, tickets: 1, revenue: 1000 }, 150)).toMatchObject({ recipeCostCents: 300, contributionCents: 700 });
    expect(addOnProfitRow({ key: 'k', serviceId: null, name: 'N', units: 2, tickets: 1, revenue: 1000 }, null)).toMatchObject({ recipeCostCents: null, contributionCents: null });
  });
});
