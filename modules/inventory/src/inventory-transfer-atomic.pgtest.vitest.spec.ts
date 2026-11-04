// inventory-transfer-atomic.pgtest — audit D9 (Nov 4 2026): a transfer between locations is ONE transaction under both
// locations' stock lock. A failure part way (here: the destination ledger write refused) leaves nothing behind — no
// header, no line, no bottle moved, no ledger row; a good transfer moves the bottles and writes both ledgers.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a7180000-0000-4000-8000-000000000001', B = 'a7180000-0000-4000-8000-0000000000b1', B2 = 'a7180000-0000-4000-8000-0000000000b2';
const UM = 'a7180000-0000-4000-8000-0000000000e9';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.vendor.manage', 'inventory.purchase_order.create', 'inventory.transfer.manage'];
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ALL };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const units = async (branch: string, pid: string) => Number((await q(`select count(*)::int n from inventory_units where tenant_id = $1 and branch_id = $2 and product_id = $3 and status in ('unopened','opened','low')`, [T, branch, pid]))[0].n);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Tr Co','Tr Salon','tr-co','TRCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$3,'Main','America/New_York'), ($2,$3,'Second','America/New_York')`, [B, B2, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@tr.test','Olive Owner')`, [UM, T]);
}, 180_000);

describe('transfer between locations is all-or-nothing', () => {
  it('a good transfer moves the bottles and writes both ledgers; a failed one leaves nothing', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Base Coat', sku: 'BC-1' });
    await inv.addStock(manager, pid, { quantity: 5 });
    const ok: any = await inv.createTransfer(manager, { toBranchId: B2, lines: [{ productId: pid, quantity: 2 }] });
    expect(await units(B, pid)).toBe(3); expect(await units(B2, pid)).toBe(2);
    const led = await q(`select branch_id, movement_type, quantity_change from inventory_stock_movements where tenant_id = $1 and product_id = $2 and movement_type like 'transfer_%' order by movement_type`, [T, pid]);
    expect(led.map((r: any) => [r.branch_id, r.movement_type, Number(r.quantity_change)])).toEqual([[B2, 'transfer_in', 2], [B, 'transfer_out', -2]]);
    expect(ok).toBeTruthy();
    const headersBefore = (await q(`select count(*)::int n from inventory_transfers where tenant_id = $1`, [T]))[0].n;
    // make the destination's ledger write fail half way: the source side has already moved bottles in this transaction
    await q(`create or replace function tr_refuse_in() returns trigger language plpgsql as $$ begin if new.movement_type = 'transfer_in' then raise exception 'ledger refused'; end if; return new; end $$`);
    await q(`create trigger trg_tr_refuse_in before insert on inventory_stock_movements for each row execute function tr_refuse_in()`);
    try { await expect(inv.createTransfer(manager, { toBranchId: B2, lines: [{ productId: pid, quantity: 1 }] })).rejects.toThrow(/ledger refused/); }
    finally { await q(`drop trigger trg_tr_refuse_in on inventory_stock_movements`); }
    expect(await units(B, pid)).toBe(3); expect(await units(B2, pid)).toBe(2);   // no bottle moved
    expect((await q(`select count(*)::int n from inventory_transfers where tenant_id = $1`, [T]))[0].n).toBe(headersBefore);
    expect((await q(`select count(*)::int n from inventory_stock_movements where tenant_id = $1 and product_id = $2 and movement_type like 'transfer_%'`, [T, pid]))[0].n).toBe(2);
  });
  it('nothing to move is refused and leaves no empty transfer', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Empty Shelf', sku: 'ES-1' });
    const before = (await q(`select count(*)::int n from inventory_transfers where tenant_id = $1`, [T]))[0].n;
    await expect(inv.createTransfer(manager, { toBranchId: B2, lines: [{ productId: pid, quantity: 1 }] })).rejects.toThrow(/No stock was available/);
    expect((await q(`select count(*)::int n from inventory_transfers where tenant_id = $1`, [T]))[0].n).toBe(before);
  });
});

// audit D9 (Nov 4 2026): reconciling a count applies counted − the snapshot taken when the count started, to TODAY's stock —
// it used to set stock to the counted number, undoing every movement between the count and its reconciliation
describe('count reconciliation uses the snapshot and is all-or-nothing', () => {
  it('a sale between the count and the reconcile is kept; the variance is counted − snapshot', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Top Coat', sku: 'TC-9' });
    await inv.addStock(manager, pid, { quantity: 10 });
    const cnt: any = await inv.createCount(manager, {});
    const countId = cnt.id ?? cnt.count?.id;
    // the shelf really holds 9 (one bottle went missing before the count)
    const lineId = (await q(`select id from inventory_count_lines where count_id = $1 and product_id = $2`, [countId, pid]))[0].id;
    expect((await q(`select expected_qty from inventory_count_lines where id = $1`, [lineId]))[0].expected_qty).toBe(10);
    await inv.enterCount(manager, countId, { lines: [{ lineId, countedQty: 9 }] });
    // after the count but before reconciling, 2 bottles are used on clients (bottle rows marked empty)
    await q(`update inventory_units set status = 'empty', updated_at = now() where id in (select id from inventory_units where tenant_id = $1 and branch_id = $2 and product_id = $3 and status = 'unopened' limit 2)`, [T, B, pid]);
    expect(await units(B, pid)).toBe(8);
    await inv.reconcileCount(manager, countId);
    // 10 at the count, 9 counted → −1; the 2 used since then stay used → 7 (it used to become 9)
    expect(await units(B, pid)).toBe(7);
    const c = (await q(`select status, variance_units from inventory_counts where id = $1`, [countId]))[0];
    expect(c).toMatchObject({ status: 'reconciled', variance_units: 1 });
    await expect(inv.reconcileCount(manager, countId)).rejects.toThrow();   // never twice
    expect(await units(B, pid)).toBe(7);
  });
});

// audit D9 (Nov 4 2026): a bottle status change and a manual recipe deduction are each one transaction
describe('bottle changes and manual deductions are all-or-nothing', () => {
  it('opening a bottle twice: the second is refused and the ledger has one row', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Cuticle Oil', sku: 'CO-1' });
    await inv.addStock(manager, pid, { quantity: 1 });
    const [u] = await q(`select id from inventory_units where tenant_id = $1 and product_id = $2`, [T, pid]);
    await inv.openUnit(manager, u.id);
    await expect(inv.openUnit(manager, u.id)).rejects.toThrow(/Cannot change bottle/);
    expect((await q(`select count(*)::int n from inventory_stock_movements where product_id = $1 and movement_type = 'bottle_opened'`, [pid]))[0].n).toBe(1);
  });
  it('a manual deduction that fails part way empties no bottle', async () => {
    const CAT = 'a7180000-0000-4000-8000-0000000000c1', SVC = 'a7180000-0000-4000-8000-0000000000d1';
    await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Manicures')`, [CAT, T, B]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$2,$3,$4,'Gel Mani',30,3000)`, [SVC, T, B, CAT]);
    const { id: pid } = await inv.createProduct(manager, { name: 'Gel Color', sku: 'GC-1' });
    await inv.addStock(manager, pid, { quantity: 3 });
    await q(`insert into service_product_recipes (tenant_id, service_id, product_id, quantity) values ($1,$2,$3,2)`, [T, SVC, pid]);
    await q(`create or replace function tr_refuse_use() returns trigger language plpgsql as $$ begin if new.movement_type = 'service_usage' then raise exception 'usage refused'; end if; return new; end $$`);
    await q(`create trigger trg_tr_refuse_use before insert on inventory_stock_movements for each row execute function tr_refuse_use()`);
    try { await expect(inv.consumeServiceRecipe(manager, SVC, 1)).rejects.toThrow(/usage refused/); }
    finally { await q(`drop trigger trg_tr_refuse_use on inventory_stock_movements`); }
    expect(await units(B, pid)).toBe(3);
    const ok: any = await inv.consumeServiceRecipe(manager, SVC, 1);
    expect(ok.deducted[0]).toMatchObject({ requested: 2, deducted: 2 });
    expect(await units(B, pid)).toBe(1);
  });
});
