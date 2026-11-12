// restock-priority.pgtest — Smart Restock Priority (Extras · Stock Alerts 08), against the real migrated schema:
//   * demand is MEASURED (effective use in the last 30 days); a product nobody used is "unknown", never guessed;
//   * stock that runs out before the preferred vendor's lead time is "now"; a committed order that covers it is "covered";
//   * rank=priority orders the whole live alert set by urgency → margin → demand and pages it; the default stays newest-first;
//   * advice only: reading it writes no purchase order, movement or alert row.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { StockAlertsRepository, paging } from './stock-alerts.repository';
import { restockAdvice, compareRestock } from './inventory-core';

const T = 'a7180000-0000-4000-8000-000000000001', B = 'a7180000-0000-4000-8000-0000000000b1';
const UM = 'a7180000-0000-4000-8000-0000000000e9', TA = 'a7180000-0000-4000-8000-0000000000c1';
const VFAST = 'a7180000-0000-4000-8000-0000000000a1', VSLOW = 'a7180000-0000-4000-8000-0000000000a2';
// PFAST: 2 on hand, uses 0.5/day, vendor lead 7 d → 4 days of cover < 7 → now
// PSLOW: 4 on hand, uses 0.1/day, vendor lead 3 d → 40 days → later
// PMID:  3 on hand, uses 0.3/day, lead 3 d → 10 days, margin 7 → soon
// PIDLE: 1 on hand, no use → unknown;  POUT: 0 on hand → now;  PCOV: 1 on hand, fully on order → covered
const PFAST = 'a7180000-0000-4000-8000-0000000000d1', PSLOW = 'a7180000-0000-4000-8000-0000000000d2', PMID = 'a7180000-0000-4000-8000-0000000000d3';
const PIDLE = 'a7180000-0000-4000-8000-0000000000d4', POUT = 'a7180000-0000-4000-8000-0000000000d5', PCOV = 'a7180000-0000-4000-8000-0000000000d6';
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'MANAGER', permissions: ['inventory.view'] };
let pg: any; let repo: StockAlertsRepository;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const count = async (table: string) => Number((await q(`select count(*)::int n from ${table} where tenant_id = $1`, [T]))[0].n);

beforeAll(async () => {
  pg = await migratedPglite();
  repo = new StockAlertsRepository(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Restock Co','Restock Salon','restock-co','RSTK')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'MANAGER','m@restock.test','Mia Manager')`, [UM, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Anna','Nguyen','Anna Nguyen')`, [TA, T, B]);
  await q(`insert into inventory_vendors (id, tenant_id, name, lead_time_days) values ($1,$3,'Fast Ship',7), ($2,$3,'Slow Co',3)`, [VFAST, VSLOW, T]);
  const prods: [string, string, number, string | null][] = [[PFAST, 'Fast Gel', 2, VFAST], [PSLOW, 'Slow Polish', 4, VSLOW], [PMID, 'Mid Base', 3, VSLOW], [PIDLE, 'Idle Top', 1, null], [POUT, 'Out Remover', 0, null], [PCOV, 'Covered Coat', 1, VSLOW]];
  for (const [id, name, onHand, vendor] of prods) {
    await q(`insert into inventory_products (id, tenant_id, name, active, reorder_level, reorder_quantity, unit_type, preferred_vendor_id) values ($1,$2,$3,true,5,4,'bottle',$4)`, [id, T, name, vendor]);
    await q(`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand) values ($1,$2,$3,$4)`, [T, B, id, onHand]);
  }
  const use = (p: string, h: number, daysAgo: number) => q(`insert into product_usage_events (tenant_id, branch_id, product_id, technician_id, quantity_hundredths, unit, occurred_at, source, stock_before_hundredths, stock_after_hundredths, bottles_before, bottles_after)
    values ($1,$2,$3,$4,$5,'bottle', now() - make_interval(days => $6), 'front_desk', 0, 0, 0, 0)`, [T, B, p, TA, h, daysAgo]);
  await use(PFAST, 1500, 3);          // 15 bottles in 30 days = 0.5 / day
  await use(PSLOW, 300, 10);          // 0.1 / day
  await use(PMID, 900, 5);            // 0.3 / day
  await use(PIDLE, 5000, 45);         // outside the window — does not count as demand
  await use(PCOV, 600, 2);
  // a committed purchase order covers PCOV's suggestion (5 - 1 = 4 → 4 on order)
  const po = (await q(`insert into purchase_orders (tenant_id, branch_id, vendor_id, po_number, status) values ($1,$2,$3,'PO-RS-1','ordered') returning id`, [T, B, VSLOW]))[0].id;
  await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received, units_per_purchase_unit) values ($1,$2,$3,4,0,1)`, [T, po, PCOV]);
}, 120000);

describe('restockAdvice (pure)', () => {
  it('cover vs lead time decides the tier; no use is unknown, never guessed', () => {
    expect(restockAdvice({ onHand: 2, onOrder: 0, suggestedReorder: 4, usedHundredths: 1500, leadTimeDays: 7 })).toMatchObject({ urgency: 'now', avgDailyHundredths: 50, daysOfCover: 4, marginDays: -3 });
    expect(restockAdvice({ onHand: 3, onOrder: 0, suggestedReorder: 4, usedHundredths: 900, leadTimeDays: 3 })).toMatchObject({ urgency: 'soon', daysOfCover: 10, marginDays: 7 });
    expect(restockAdvice({ onHand: 4, onOrder: 0, suggestedReorder: 4, usedHundredths: 300, leadTimeDays: 3 })).toMatchObject({ urgency: 'later', daysOfCover: 40 });
    expect(restockAdvice({ onHand: 1, onOrder: 0, suggestedReorder: 4, usedHundredths: 0, leadTimeDays: null })).toMatchObject({ urgency: 'unknown', avgDailyHundredths: null, daysOfCover: null, marginDays: null });
    expect(restockAdvice({ onHand: 0, onOrder: 0, suggestedReorder: 5, usedHundredths: 0, leadTimeDays: null }).urgency).toBe('now');
    expect(restockAdvice({ onHand: 1, onOrder: 4, suggestedReorder: 0, usedHundredths: 600, leadTimeDays: 3 }).urgency).toBe('covered');
    // a missing lead time is reported as missing (null), the margin is then cover alone
    expect(restockAdvice({ onHand: 2, onOrder: 0, suggestedReorder: 4, usedHundredths: 1500, leadTimeDays: null })).toMatchObject({ leadTimeDays: null, marginDays: 4, urgency: 'soon' });
  });
  it('compareRestock: tier, then least margin, then higher demand, then name', () => {
    const a = (name: string, i: Parameters<typeof restockAdvice>[0]) => ({ name, restock: restockAdvice(i) });
    const list = [
      a('Later', { onHand: 4, onOrder: 0, suggestedReorder: 4, usedHundredths: 300, leadTimeDays: 3 }),
      a('Unknown', { onHand: 1, onOrder: 0, suggestedReorder: 4, usedHundredths: 0, leadTimeDays: null }),
      a('Now-small', { onHand: 2, onOrder: 0, suggestedReorder: 4, usedHundredths: 1500, leadTimeDays: 5 }),
      a('Now-big', { onHand: 2, onOrder: 0, suggestedReorder: 4, usedHundredths: 1500, leadTimeDays: 7 }),
    ].sort(compareRestock).map((x) => x.name);
    expect(list).toEqual(['Now-big', 'Now-small', 'Unknown', 'Later']);
  });
});

describe('activeAlerts rank=priority', () => {
  it('every row carries measured restock advice from the last 30 days and the vendor lead time', async () => {
    const rows = (await repo.activeAlerts(manager, {}, paging(undefined, '50'))).rows;
    const by = (id: string) => rows.find((r) => r.productId === id)!.restock;
    expect(by(PFAST)).toMatchObject({ urgency: 'now', avgDailyUse: '0.5', daysOfCover: 4, leadTimeDays: 7, windowDays: 30 });
    expect(by(PMID)).toMatchObject({ urgency: 'soon', avgDailyUse: '0.3', daysOfCover: 10, leadTimeDays: 3 });
    expect(by(PSLOW)).toMatchObject({ urgency: 'later', avgDailyUse: '0.1', daysOfCover: 40 });
    expect(by(PIDLE)).toMatchObject({ urgency: 'unknown', avgDailyUse: null, usedHundredths: 0 });   // the 45-day-old use is outside the window
    expect(by(POUT).urgency).toBe('now');
    expect(by(PCOV).urgency).toBe('covered');
  });
  it('ranks the whole set by urgency and pages it; the default list is unchanged (newest first)', async () => {
    const p1 = await repo.activeAlerts(manager, { rank: 'priority' }, paging('1', '3'));
    const p2 = await repo.activeAlerts(manager, { rank: 'priority' }, paging('2', '3'));
    expect(p1.rank).toBe('priority'); expect(p1.total).toBe(6);
    // now: Fast Gel (margin −3) before Out Remover (no demand → no margin); soon; unknown; later; covered
    expect([...p1.rows, ...p2.rows].map((r) => r.name)).toEqual(['Fast Gel', 'Out Remover', 'Mid Base', 'Idle Top', 'Slow Polish', 'Covered Coat']);
    const def = await repo.activeAlerts(manager, {}, paging('1', '50'));
    expect(def.rank).toBe('newest');
    expect(def.rows.map((r) => r.name)).toEqual(['Out Remover', 'Covered Coat', 'Fast Gel', 'Idle Top', 'Mid Base', 'Slow Polish']);   // severity then name (no alert rows yet)
  });
  it('is advice only — no purchase order, movement or alert row is written', async () => {
    const before = [await count('purchase_orders'), await count('inventory_stock_movements'), await count('inventory_alerts')];
    await repo.activeAlerts(manager, { rank: 'priority' }, paging());
    expect([await count('purchase_orders'), await count('inventory_stock_movements'), await count('inventory_alerts')]).toEqual(before);
  });
});
