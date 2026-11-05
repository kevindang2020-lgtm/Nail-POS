// inventory-transfer-transit.pgtest — D9 gaps (Nov 5 2026): a SHIPPED transfer takes the bottles off the source and puts them on
// hand nowhere until the destination receives them; a partial receipt records the rest missing at the destination; the source
// can cancel while in transit (bottles come back as they left); receive / cancel happen once and only at the right end.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const P = 'a7190000-0000-4000-8000-0000000000';
const T = P + '01', B = P + 'b1', B2 = P + 'b2', UM = P + 'e9';
const ALL = ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust', 'inventory.transfer'];
const src: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ALL };
const dst: any = { ...src, branchId: B2 };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const onHand = async (branch: string, pid: string) => Number((await q(`select count(*)::int n from inventory_units where tenant_id = $1 and branch_id = $2 and product_id = $3 and status in ('unopened','opened','low')`, [T, branch, pid]))[0].n);
const cache = async (branch: string, pid: string) => Number((await q(`select quantity_on_hand from inventory_location_stock where tenant_id = $1 and branch_id = $2 and product_id = $3`, [T, branch, pid]))[0]?.quantity_on_hand ?? 0);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Tt Co','Tt Salon','tt-co','TTCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$3,'Main','America/New_York'), ($2,$3,'Second','America/New_York')`, [B, B2, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@tt.test','Olive Owner')`, [UM, T]);
}, 180_000);

describe('shipped transfers', () => {
  it('ship 3 → on hand nowhere; receive 2 → destination +2 (opened stays opened), 1 missing; a second receive is refused', async () => {
    const { id: pid } = await inv.createProduct(src, { name: 'Gel Red', sku: 'GR-1' });
    await inv.addStock(src, pid, { quantity: 4 });
    const [u1] = await q(`select id from inventory_units where product_id = $1 order by id limit 1`, [pid]);
    await inv.openUnit(src, u1.id);
    const tr: any = await inv.createTransfer(src, { toBranchId: B2, ship: true, lines: [{ productId: pid, quantity: 3 }] });
    expect(tr.transfer.status).toBe('in_transit');
    expect(await onHand(B, pid)).toBe(1); expect(await onHand(B2, pid)).toBe(0); expect(await cache(B, pid)).toBe(1);
    await expect(inv.receiveTransfer(src, tr.transfer.id, {})).rejects.toThrow(/receiving location/);
    const got: any = await inv.receiveTransfer(dst, tr.transfer.id, { lines: [{ productId: pid, received: 2 }] });
    expect(got.transfer.status).toBe('completed');
    expect(got.lines[0].quantity_received).toBe(2);
    expect(await onHand(B2, pid)).toBe(2); expect(await cache(B2, pid)).toBe(2);
    expect((await q(`select count(*)::int n from inventory_units where product_id = $1 and branch_id = $2 and status = 'missing'`, [pid, B2]))[0].n).toBe(1);
    expect((await q(`select count(*)::int n from inventory_units where product_id = $1 and status = 'in_transit'`, [pid]))[0].n).toBe(0);
    await expect(inv.receiveTransfer(dst, tr.transfer.id, {})).rejects.toThrow(/not in transit/);
  });
  it('cancel while in transit: only the source, with a reason; bottles come back; then neither end can act again', async () => {
    const { id: pid } = await inv.createProduct(src, { name: 'Gel Blue', sku: 'GB-1' });
    await inv.addStock(src, pid, { quantity: 2 });
    const tr: any = await inv.createTransfer(src, { toBranchId: B2, ship: true, lines: [{ productId: pid, quantity: 2 }] });
    expect(await onHand(B, pid)).toBe(0);
    await expect(inv.cancelTransfer(dst, tr.transfer.id, { reason: 'wrong store' })).rejects.toThrow(/sending location/);
    await expect(inv.cancelTransfer(src, tr.transfer.id, { reason: ' ' })).rejects.toThrow(/reason/);
    const c: any = await inv.cancelTransfer(src, tr.transfer.id, { reason: 'Driver did not come' });
    expect(c.transfer.status).toBe('cancelled');
    expect(await onHand(B, pid)).toBe(2); expect(await cache(B, pid)).toBe(2);
    await expect(inv.receiveTransfer(dst, tr.transfer.id, {})).rejects.toThrow(/not in transit/);
  });
  it('the immediate transfer is unchanged', async () => {
    const { id: pid } = await inv.createProduct(src, { name: 'Gel Pink', sku: 'GP-1' });
    await inv.addStock(src, pid, { quantity: 2 });
    const tr: any = await inv.createTransfer(src, { toBranchId: B2, lines: [{ productId: pid, quantity: 2 }] });
    expect(tr.transfer.status).toBe('completed');
    expect(await onHand(B2, pid)).toBe(2);
  });
});
