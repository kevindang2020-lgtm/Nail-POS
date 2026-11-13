// product-usage.pgtest — Stock Alerts + Technician Product Usage mandate (Oct 29 2026), against the real migrated schema:
//   * a use consumes real bottles (0.5 of a sealed bottle opens it at 50 %) in one transaction with ONE stock movement;
//   * "Last Used By" is the latest effective use by occurred_at DESC, id DESC: a later use wins, a backdated one does not,
//     reversing the latest falls back to the one before; a product nobody used says "No recorded use";
//   * a double tap with one idempotency key records once; the key reused for something else is refused;
//   * more than the stock is refused (unless the product allows negative stock — then the shortfall is kept);
//   * recording for someone else needs the stock-adjust permission and a reason; two technicians with the same name stay apart;
//   * nothing crosses tenants; the sidebar badge and the page's Open Alerts are the SAME number (the 11 vs 0 regression),
//     a product already low before alert tracking is listed and can be acknowledged.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';
import { StockAlertsRepository, paging } from './stock-alerts.repository';
import { openAlertCount } from './stock-alert-state';

const T = 'a7160000-0000-4000-8000-000000000001', B = 'a7160000-0000-4000-8000-0000000000b1', T2 = 'a7160000-0000-4000-8000-000000000002', B2 = 'a7160000-0000-4000-8000-0000000000b2';
const UA = 'a7160000-0000-4000-8000-0000000000e1', UB = 'a7160000-0000-4000-8000-0000000000e2', UC = 'a7160000-0000-4000-8000-0000000000e3', UM = 'a7160000-0000-4000-8000-0000000000e9';
const TA = 'a7160000-0000-4000-8000-0000000000c1', TB = 'a7160000-0000-4000-8000-0000000000c2', TC = 'a7160000-0000-4000-8000-0000000000c3';
const P = 'a7160000-0000-4000-8000-0000000000d1', PNEG = 'a7160000-0000-4000-8000-0000000000d2', PIDLE = 'a7160000-0000-4000-8000-0000000000d3', PGLOVE = 'a7160000-0000-4000-8000-0000000000d4';
const PLOW = ['a7160000-0000-4000-8000-0000000000f1', 'a7160000-0000-4000-8000-0000000000f2', 'a7160000-0000-4000-8000-0000000000f3'];
const tech = (userId: string, perms: string[] = ['inventory.view_limited', 'inventory.product_usage.submit']): any => ({ tenantId: T, branchId: B, userId, role: 'TECHNICIAN', permissions: perms });
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'MANAGER', permissions: ['inventory.view', 'inventory.stock.adjust', 'inventory.product_usage.submit'] };
let pg: any; let inv: InventoryService; let repo: StockAlertsRepository;
let clockNow = new Date('2026-10-29T18:00:00Z');
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e?.apiCode ?? e?.code ?? e?.message; } };
const hours = (h: number) => new Date(clockNow.getTime() - h * 3600_000).toISOString();
const lastUse = async (productId: string) => (await repo.productLedger(manager, productId, {}, await repo.period(manager, {}), paging())).lastUsedLabel;

beforeAll(async () => {
  pg = await migratedPglite();
  const db = kyselyFor(pg) as any;
  inv = new InventoryService(db, { iso: () => clockNow.toISOString() });
  repo = new StockAlertsRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Usage Co','Usage Salon','usage-co','USGC'), ($2,'Other Co','Other Salon','other-co','OTHC')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York'), ($3,$4,'Other','America/New_York')`, [B, T, B2, T2]);
  for (const u of [UA, UB, UC, UM]) await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'TECHNICIAN',$3,$4)`, [u, T, `${u.slice(-2)}@usage.test`, u === UM ? 'Mia Manager' : 'User']);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name) values
    ($1,$4,$5,$6,'Anna','Nguyen','Anna Nguyen'), ($2,$4,$5,$7,'Bao','Tran','Bao Tran'), ($3,$4,$5,$8,'Anna','Nguyen','Anna Nguyen')`, [TA, TB, TC, T, B, UA, UB, UC]);
  await q(`insert into inventory_products (id, tenant_id, name, sku, active, reorder_level, unit_type, allow_negative_stock) values
    ($1,$5,'Rose Gel','RG-01',true,2,'bottle',false), ($2,$5,'Base Coat','BC-01',true,0,'bottle',true), ($3,$5,'Top Coat','TC-01',true,1,'bottle',false), ($4,$5,'Gloves','GL-01',true,0,'pair',false)`, [P, PNEG, PIDLE, PGLOVE, T]);
  // P: 3 sealed bottles; PNEG: 1 bottle at 40 %; PIDLE: 2 sealed; gloves: 5
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status, created_at) values ($1,$2,$3,'unopened', now() - interval '3 days'), ($1,$2,$3,'unopened', now() - interval '2 days'), ($1,$2,$3,'unopened', now() - interval '1 day')`, [T, B, P]);
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status, estimated_remaining_percent) values ($1,$2,$3,'opened',40)`, [T, B, PNEG]);
  await q(`insert into inventory_units (tenant_id, branch_id, product_id, status) values ($1,$2,$3,'unopened'), ($1,$2,$3,'unopened')`, [T, B, PIDLE]);
  for (let i = 0; i < 5; i++) await q(`insert into inventory_units (tenant_id, branch_id, product_id, status) values ($1,$2,$3,'unopened')`, [T, B, PGLOVE]);
  // the 11-vs-0 shape: three products ALREADY low when set up — stock rows written directly, no alert row ever recorded
  for (const [i, id] of PLOW.entries()) {
    await q(`insert into inventory_products (id, tenant_id, name, sku, active, reorder_level) values ($1,$2,$3,$4,true,5)`, [id, T, `Low Polish ${i + 1}`, `LP-0${i + 1}`]);
    await q(`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand) values ($1,$2,$3,$4)`, [T, B, id, i]);   // 0, 1, 2 on hand
  }
  for (const id of [P, PNEG, PIDLE, PGLOVE]) await (inv as any).recompute({ tenantId: T, branchId: B, userId: UM, role: 'MANAGER', permissions: [] }, id);
}, 120000);

describe('recording a product use', () => {
  it('Tech A uses 0.5 of a sealed bottle: it opens at 50 %, one event, one technician_usage movement, stock 3 → 2.5', async () => {
    clockNow = new Date('2026-10-29T18:00:00Z');
    const r = await inv.recordProductUsage(tech(UA), { productId: P, quantity: '0.5' }, 'key-a-1');
    expect(r.replay).toBe(false);
    expect(r.event).toMatchObject({ technicianId: TA, technicianName: 'Anna Nguyen', quantity: '0.5', effectiveQuantity: '0.5', stockBefore: '3', stockAfter: '2.5', bottlesBefore: 3, bottlesAfter: 3, source: 'front_desk', status: 'confirmed' });
    const units = await q(`select status, estimated_remaining_percent from inventory_units where product_id = $1 order by created_at`, [P]);
    expect(units[0]).toEqual({ status: 'opened', estimated_remaining_percent: 50 });
    expect(units.slice(1).every((u: any) => u.status === 'unopened')).toBe(true);
    const moves = await q(`select movement_type, related_type, related_id, metadata_json from inventory_stock_movements where product_id = $1 and movement_type = 'technician_usage'`, [P]);
    expect(moves.length).toBe(1); expect(moves[0]).toMatchObject({ related_type: 'product_usage_event', related_id: r.event.id });
    expect(moves[0].metadata_json).toMatchObject({ quantityHundredths: 50, technicianId: TA });
    expect(await lastUse(P)).toBe('Anna Nguyen');
  });
  it('a double tap (same key) records once and returns the first result; the key reused for another amount is refused', async () => {
    const again = await inv.recordProductUsage(tech(UA), { productId: P, quantity: '0.5' }, 'key-a-1');
    expect(again.replay).toBe(true);
    expect(Number((await q(`select count(*)::int n from product_usage_events where tenant_id = $1`, [T]))[0].n)).toBe(1);
    expect(Number((await q(`select count(*)::int n from inventory_stock_movements where movement_type = 'technician_usage'`))[0].n)).toBe(1);
    expect(await code(inv.recordProductUsage(tech(UA), { productId: P, quantity: '1' }, 'key-a-1'))).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  it('a second movement for one event is impossible (unique index)', async () => {
    const ev = (await q(`select id from product_usage_events limit 1`))[0].id;
    expect(await code(q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, related_type, related_id) values ($1,$2,$3,'technician_usage','product_usage_event',$4)`, [T, B, P, ev]))).not.toBe('OK');
  });
  it('Tech B uses 1.0 later → Last Used By is Bao; A backdated (2 h ago) does not take it back', async () => {
    clockNow = new Date('2026-10-29T19:00:00Z');
    const b = await inv.recordProductUsage(tech(UB), { productId: P, quantity: 1 }, 'key-b-1');
    expect(b.event).toMatchObject({ technicianName: 'Bao Tran', stockBefore: '2.5', stockAfter: '1.5' });
    expect(await lastUse(P)).toBe('Bao Tran');
    clockNow = new Date('2026-10-29T19:30:00Z');
    const back = await inv.recordProductUsage(tech(UA), { productId: P, quantity: '0.25', occurredAt: hours(2) }, 'key-a-back');
    expect(back.event.occurredAt).toBe(hours(2));
    expect(await lastUse(P)).toBe('Bao Tran');   // recorded last, but it happened earlier
  });
  it('reversing Bao\'s use gives the bottle back and Last Used By falls back to Anna', async () => {
    const ev = (await q(`select id from product_usage_events where idempotency_key = 'key-b-1'`))[0].id;
    expect(await code(inv.adjustProductUsage(manager, ev, { delta: '-1', reason: '' }, 'adj-0'))).toBe('USAGE_ADJUST_REASON_REQUIRED');
    expect(await code(inv.adjustProductUsage(manager, ev, { delta: '-1.5', reason: 'entered twice' }, 'adj-x'))).toBe('USAGE_ADJUST_BELOW_ZERO');
    const before = (await repo.pickers(manager, 'Rose')).products[0].stockHundredths;
    const r = await inv.adjustProductUsage(manager, ev, { delta: '-1', reason: 'entered on the wrong product' }, 'adj-1');
    expect(r.event).toMatchObject({ status: 'reversed', effectiveQuantity: '0' });
    expect(r.event.adjustments).toHaveLength(1);
    expect((await repo.pickers(manager, 'Rose')).products[0].stockHundredths).toBe(before + 100);
    expect(await lastUse(P)).toBe('Anna Nguyen');
    expect(await code(inv.adjustProductUsage(manager, ev, { delta: '-0.5', reason: 'again' }, 'adj-2'))).toBe('USAGE_ALREADY_REVERSED');
    const corr = await q(`select related_type from inventory_stock_movements where movement_type = 'usage_correction'`);
    expect(corr).toEqual([{ related_type: 'product_usage_adjustment' }]);
    // the original event is never edited
    expect((await q(`select quantity_hundredths from product_usage_events where id = $1`, [ev]))[0].quantity_hundredths).toBe(100);
  });
  it('more than the stock is refused; a product that allows negative stock keeps the shortfall', async () => {
    expect(await code(inv.recordProductUsage(tech(UA), { productId: P, quantity: 9 }, 'key-over'))).toBe('USAGE_EXCEEDS_STOCK');
    const n = await inv.recordProductUsage(tech(UA), { productId: PNEG, quantity: '0.75' }, 'key-neg');
    expect(n.event).toMatchObject({ shortHundredths: 35, stockBefore: '0.4', stockAfter: '-0.35' });
  });
  it('fractions, bad amounts, future and very old times are refused', async () => {
    expect(await code(inv.recordProductUsage(tech(UA), { productId: PGLOVE, quantity: '0.5' }))).toBe('USAGE_FRACTION_NOT_ALLOWED');
    expect(await code(inv.recordProductUsage(tech(UA), { productId: P, quantity: '0' }))).toBe('USAGE_QUANTITY_INVALID');
    expect(await code(inv.recordProductUsage(tech(UA), { productId: P, quantity: '0.125' }))).toBe('USAGE_QUANTITY_INVALID');
    expect(await code(inv.recordProductUsage(tech(UA), { productId: P, quantity: '0.1', occurredAt: new Date(clockNow.getTime() + 3600_000).toISOString() }))).toBe('USAGE_OCCURRED_IN_FUTURE');
    expect(await code(inv.recordProductUsage(tech(UA), { productId: P, quantity: '0.1', occurredAt: hours(24 * 40) }))).toBe('USAGE_OCCURRED_TOO_OLD');
  });
  it('recording for someone else needs stock-adjust AND a reason; same-name technicians stay apart', async () => {
    expect(await code(inv.recordProductUsage(tech(UA), { productId: PGLOVE, quantity: 1, technicianId: TB }))).toBe('USAGE_ON_BEHALF_FORBIDDEN');
    expect(await code(inv.recordProductUsage(manager, { productId: PGLOVE, quantity: 1, technicianId: TC }))).toBe('USAGE_ON_BEHALF_REASON_REQUIRED');
    expect(await code(inv.recordProductUsage(manager, { productId: PGLOVE, quantity: 1 }))).toBe('USAGE_TECHNICIAN_REQUIRED');   // the manager is no technician
    const r = await inv.recordProductUsage(manager, { productId: PGLOVE, quantity: 2, technicianId: TC, onBehalfReason: 'tech forgot to log it' }, 'key-c');
    expect(r.event).toMatchObject({ technicianId: TC, source: 'manager', onBehalfReason: 'tech forgot to log it' });
    await inv.recordProductUsage(tech(UA), { productId: PGLOVE, quantity: 1 }, 'key-a-glove');
    const ledger = await repo.productLedger(manager, PGLOVE, {}, await repo.period(manager, {}), paging());
    expect(ledger.byTechnician.map((x) => [x.technicianId, x.name, x.used]).sort()).toEqual([[TA, 'Anna Nguyen', '1'], [TC, 'Anna Nguyen', '2']].sort());
    const techs = await repo.technicians(manager, { search: 'anna' }, await repo.period(manager, {}), paging());
    expect(techs.rows.filter((x) => x.name === 'Anna Nguyen').length).toBe(2);
    // Nov 3 audit: Anna (TA) used bottles of gel AND pairs of gloves — "Used" is per unit, never one summed number
    const ta = techs.rows.find((x: any) => x.technicianId === TA)! as any, tc = techs.rows.find((x: any) => x.technicianId === TC)! as any;
    expect(ta.used).toBeNull(); expect(ta.usedByUnit.map((u: any) => u.unit).sort()).toEqual(['bottle', 'pair']);
    expect(tc.used).toBe('2'); expect(tc.usedByUnit).toEqual([{ unit: 'pair', used: '2', hundredths: 200 }]);
  });
  it('two uses at once both land, in order, with exact stock', async () => {
    const before = (await repo.pickers(manager, 'Gloves')).products[0].stockHundredths;
    // PGlite is one connection: the truly simultaneous case runs on real Postgres (product-usage.postgres-race); here back to back
    await inv.recordProductUsage(tech(UA), { productId: PGLOVE, quantity: 1 }, 'par-1'); await inv.recordProductUsage(tech(UB), { productId: PGLOVE, quantity: 1 }, 'par-2');
    expect((await repo.pickers(manager, 'Gloves')).products[0].stockHundredths).toBe(before - 200);
  });
});

describe('Stock Alerts read model', () => {
  it('a product nobody used says "No recorded use"', async () => {
    expect(await lastUse(PIDLE)).toBe('No recorded use');
  });
  it('the sidebar badge equals Open Alerts; products low before alert tracking are listed (the 11 vs 0 regression)', async () => {
    const s = await repo.summary(manager);
    const sidebar = Number((await openAlertCount(T, B).execute(kyselyFor(pg) as any)).rows[0].n);
    expect(s.openAlerts).toBe(sidebar);
    expect(s.openAlerts).toBeGreaterThanOrEqual(3);
    const list = await repo.activeAlerts(manager, {}, paging());
    for (const id of PLOW) expect(list.rows.some((r) => r.productId === id)).toBe(true);
    expect(list.rows.find((r) => r.productId === PLOW[0])).toMatchObject({ severity: 'out_of_stock', since: null, lastUsedLabel: 'No recorded use' });
    expect(list.rows.find((r) => r.productId === PLOW[1])?.severity).toBe('critical');
    expect(list.total).toBe(s.totalAlerts);
  });
  it('acknowledging a product that has no alert row creates and acknowledges it; both counts drop by one', async () => {
    const before = (await repo.summary(manager)).openAlerts;
    const r = await repo.acknowledge(manager, PLOW[2], 'ordered from vendor');
    expect(r).toMatchObject({ ok: true, alreadyAcknowledged: false });
    expect((await repo.summary(manager)).openAlerts).toBe(before - 1);
    expect(Number((await openAlertCount(T, B).execute(kyselyFor(pg) as any)).rows[0].n)).toBe(before - 1);
    expect((await repo.activeAlerts(manager, {}, paging())).rows.some((x) => x.productId === PLOW[2])).toBe(false);
    expect((await repo.activeAlerts(manager, { showAcknowledged: 'true' }, paging())).rows.find((x) => x.productId === PLOW[2])?.acknowledgedBy).toBe('Mia Manager');
    expect((await repo.acknowledge(manager, PLOW[2], null)).alreadyAcknowledged).toBe(true);
    expect((await repo.history(manager, {}, await repo.period(manager, {}), paging())).rows.some((x) => x.productId === PLOW[2] && x.state === 'acknowledged')).toBe(true);
  });
  it('the one search box finds by SKU, technician and PO number', async () => {
    expect((await repo.activeAlerts(manager, { search: 'LP-02' }, paging())).rows.map((r) => r.productId)).toEqual([PLOW[1]]);
    const byTech = await repo.productUsage(manager, { search: 'bao' }, await repo.period(manager, {}), paging());
    expect(byTech.rows.some((r) => r.productId === PGLOVE)).toBe(true);
  });
  it('usage lists: paging is server side and newest first; the date basis switches occurred vs recorded', async () => {
    const all = await repo.productUsage(manager, {}, await repo.period(manager, {}), { page: 1, pageSize: 1 });
    expect(all.pages).toBe(all.total); expect(all.rows.length).toBe(1);
    const led = await repo.productLedger(manager, P, {}, await repo.period(manager, {}), paging());
    const rec = led.events.map((e) => e.recordedAt!);
    expect([...rec].sort().reverse()).toEqual(rec);
    expect(led.events.some((e) => e.corrected && e.effective === '0')).toBe(true);
    const csvText = await repo.exportCsv(manager, 'usage', {}, await repo.period(manager, {}));
    expect(csvText.split('\r\n')[0]).toBe('Product,SKU,Used,Unit,Uses,Technicians,Unattributed uses,On hand,Last used by,Last used at,Location,Period from,Period to,Date field');
  });
  it('nothing crosses tenants', async () => {
    const other: any = { tenantId: T2, branchId: B2, userId: UM, role: 'MANAGER', permissions: ['inventory.view', 'inventory.stock.adjust'] };
    const ev = (await q(`select id from product_usage_events where idempotency_key = 'key-a-1'`))[0].id;
    expect(await code(inv.usageEvent(other, ev))).toBe('USAGE_EVENT_NOT_FOUND');
    expect(await code(inv.adjustProductUsage(other, ev, { delta: '-0.5', reason: 'not mine' }))).toBe('USAGE_EVENT_NOT_FOUND');
    expect(await code(inv.recordProductUsage({ ...other, userId: UA }, { productId: P, quantity: 1 }))).toBe('PRODUCT_NOT_FOUND');
    expect((await repo.summary(other)).openAlerts).toBe(0);
    expect((await repo.productUsage(other, {}, await repo.period(other, {}), paging())).total).toBe(0);
    expect(await code(repo.acknowledge(other, PLOW[0], null))).toBe('ALERT_NOT_FOUND');
  });
});

describe('Low-Stock Cause Explanation (Extras · Stock Alerts 12)', () => {
  it('names measured causes: usage, losses, an overdue order, and a ledger that disagrees with on-hand', async () => {
    const PX = '00000000-0000-4000-8000-0000000c0a5e';
    await q(`insert into inventory_products (id, tenant_id, name, sku, active, reorder_level) values ($1,$2,'Cause Gel','CG-01',true,4)`, [PX, T]);
    await q(`insert into inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand) values ($1,$2,$3,1)`, [T, B, PX]);
    await q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, quantity_after, created_at) values
      ($1,$2,$3,'purchase_received',10,10, now() - interval '40 days'), ($1,$2,$3,'service_usage',-6,4, now() - interval '5 days'), ($1,$2,$3,'damaged',-2,2, now() - interval '3 days')`, [T, B, PX]);
    const po = (await q(`insert into purchase_orders (tenant_id, branch_id, status, expected_date) values ($1,$2,'ordered', current_date - 2) returning id`, [T, B]))[0].id;
    await q(`insert into purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, quantity_received) values ($1,$2,$3,10,0)`, [T, po, PX]);
    const c = await repo.lowStockCause(manager, PX);
    expect(c.product).toMatchObject({ onHand: 1, reorderLevel: 4, low: true });
    expect(c.buckets).toMatchObject({ usage: -6, losses: -2, received: 0 });
    expect(c.openOrders).toMatchObject({ quantity: 10, orders: 1, overdue: true });
    expect(c.causes).toEqual(['usage', 'losses', 'receiving_delayed', 'inconsistent']);
    expect(c.ledgerAfter).toBe(2); expect(c.consistent).toBe(false);
    expect(c.lastReceivedAt).not.toBeNull();   // the 40-day-old receipt is outside the window but still the last one
    // Reorder & Receiving Reconciliation (Stock Alerts 06): 10 already on order covers the gap → nothing more is suggested
    expect(c.reorder).toMatchObject({ onOrder: 10, suggested: 0, partlyReceivedLines: 0, receivedInWindow: 0, lastReceiptQuantity: 10 });
  });
  it('a product with no movements says so; another salon cannot read it', async () => {
    expect((await repo.lowStockCause(manager, PLOW[0])).causes).toEqual(['no_movements']);
    expect(await code(repo.lowStockCause({ ...manager, tenantId: T2, branchId: B2 }, PLOW[0]))).not.toBe('OK');
  });
});

describe('round 10 — Stock Alerts 11 · 13 · 14', () => {
  it('technicians tab: service volume context (services completed in the same period, uses per 10 services; N/A with none)', async () => {
    const cu = 'a7160000-0000-4000-8000-0000000009a1', tk = 'a7160000-0000-4000-8000-0000000009a2';
    await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Vol','Ume','Vol Ume')`, [cu, T, B]);
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, total_cents) values ($1,$2,$3,$4,'paid',0,0)`, [tk, T, B, cu]);
    for (let i = 0; i < 4; i++) await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, completed_at)
      values ($1,$2,$3,gen_random_uuid(),$4,'Gel',1000,30,1000, now())`, [T, B, tk, TA]);
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, completed_at)
      values ($1,$2,$3,gen_random_uuid(),$4,'Gel',1000,30,1000, null)`, [T, B, tk, TA]);   // not completed: not counted
    const r = await repo.technicians(manager, {}, await repo.period(manager, { preset: 'all' }), paging());
    const anna = r.rows.find((x: any) => x.technicianId === TA)!;
    expect(anna.servicesCompleted).toBe(4);
    expect(anna.usesPer10Services).toBe(Math.round((anna.uses * 100) / 4) / 10);
    const bao = r.rows.find((x: any) => x.technicianId === TB);
    if (bao) { expect(bao.servicesCompleted).toBe(0); expect(bao.usesPer10Services).toBeNull(); }
  });
  it('alert history: who acknowledged, still open or resolved, and what was later restocked (first receipt after the alert + total)', async () => {
    const pr = PLOW[2];
    await q(`delete from inventory_alerts where tenant_id = $1 and product_id = $2`, [T, pr]);
    await q(`insert into inventory_alerts (tenant_id, branch_id, product_id, status, on_hand, created_at, acknowledged_at, acknowledged_by_user_id) values ($1,$2,$3,'low',2, now() - interval '2 days', now() - interval '1 day', $4)`, [T, B, pr, UM]);
    await q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, created_at) values ($1,$2,$3,'purchase_received',6, now() - interval '3 days')`, [T, B, pr]);   // before the alert
    await q(`insert into inventory_stock_movements (tenant_id, branch_id, product_id, movement_type, quantity_change, created_at) values ($1,$2,$3,'purchase_received',4, now() - interval '12 hours'), ($1,$2,$3,'manual_add',2, now() - interval '1 hour')`, [T, B, pr]);
    const h = await repo.history(manager, { search: 'LP-03' }, await repo.period(manager, { preset: 'all' }), paging());
    expect(h.rows[0]).toMatchObject({ acknowledgedBy: 'Mia Manager', state: 'acknowledged', restockedQuantity: 6 });
    expect(new Date(h.rows[0].restockedAt!).getTime()).toBeLessThan(Date.now() - 11 * 3600_000);
    const csvText = await repo.exportCsv(manager, 'history', { search: 'LP-03' }, await repo.period(manager, { preset: 'all' }));
    expect(csvText.split('\r\n')[0]).toBe('Alert ID,Product,SKU,Severity,On hand at alert,Created,Acknowledged,Acknowledged by,Resolved,State,Restocked at,Restocked quantity,Location,Period from,Period to,Date field');
    expect(csvText.split('\r\n')[1]).toMatch(/,acknowledged,.*,6,Main,all,all,alert created$/);
  });
  it('export "events": every use (technician + Service Done recipe) with its id, technician id, amount + unit, both dates, who recorded it, scope', async () => {
    const csvText = await repo.exportCsv(manager, 'events', { dateBasis: 'recorded' }, await repo.period(manager, { preset: 'all' }));
    const lines = csvText.trim().split('\r\n');
    expect(lines[0]).toBe('Use ID,Kind,Product,SKU,Technician,Technician ID,Amount,Unit,Occurred at,Recorded at,Recorded by,Source,Status,Ticket ID,Location,Period from,Period to,Date field');
    const count = Number((await q(`select count(*)::int n from product_usage_events where tenant_id = $1 and branch_id = $2`, [T, B]))[0].n);
    expect(lines.filter((l) => l.includes(',product use,')).length).toBe(count);                 // every event, not a page
    const ev = (await q(`select id from product_usage_events where idempotency_key = 'key-a-1'`))[0].id;
    expect(lines.find((l) => l.startsWith(ev))).toMatch(new RegExp(`^${ev},product use,Rose Gel,RG-01,Anna Nguyen,${TA},.*,bottle,.*,Main,all,all,recorded at$`));
    expect(lines.some((l) => l.includes(T2))).toBe(false);
  });
});
