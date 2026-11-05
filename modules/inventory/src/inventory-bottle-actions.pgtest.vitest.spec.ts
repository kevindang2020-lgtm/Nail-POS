// inventory-bottle-actions.pgtest — D9 gaps (Nov 5 2026): a bottle can be marked expired or missing, found again,
// and thrown away. Each change moves the on-hand count once, writes one ledger row and one audit, and a change the
// bottle rules do not allow is refused.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a7190000-0000-4000-8000-000000000001', B = 'a7190000-0000-4000-8000-0000000000b1', UM = 'a7190000-0000-4000-8000-0000000000e9';
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ['*', 'inventory.view', 'inventory.cost.view', 'inventory.stock.adjust'] };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const status = async (id: string) => (await q(`select status from inventory_units where id = $1`, [id]))[0].status;
const onHand = async (pid: string) => Number((await q(`select count(*)::int n from inventory_units where product_id = $1 and status in ('unopened','opened','low')`, [pid]))[0].n);
const moves = async (pid: string, type: string) => Number((await q(`select count(*)::int n from inventory_stock_movements where product_id = $1 and movement_type = $2`, [pid, type]))[0].n);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Bt Co','Bt Salon','bt-co','BTCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@bt.test','Olive Owner')`, [UM, T]);
}, 180_000);

describe('bottle actions: expired, missing, found, thrown away', () => {
  it('expired then thrown away: stock drops once, two ledger rows, a thrown-away bottle cannot come back', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Base Coat', sku: 'BC-1' });
    await inv.addStock(manager, pid, { quantity: 2 });
    const [u] = await q(`select id from inventory_units where product_id = $1 order by id limit 1`, [pid]);
    await inv.markExpired(manager, u.id);
    expect(await status(u.id)).toBe('expired');
    expect(await onHand(pid)).toBe(1);
    await inv.dispose(manager, u.id);
    expect(await status(u.id)).toBe('disposed');
    expect(await onHand(pid)).toBe(1);
    expect(await moves(pid, 'expired')).toBe(1);
    expect(await moves(pid, 'waste')).toBe(1);
    await expect(inv.markFound(manager, u.id)).rejects.toThrow(/Cannot change bottle/);
    await expect(inv.dispose(manager, u.id)).rejects.toThrow(/Cannot change bottle/);
    expect((await q(`select count(*)::int n from audit_logs where tenant_id = $1 and action_type in ('inventory_bottle_expired','inventory_bottle_disposed')`, [T]))[0].n).toBe(2);
  });
  it('an unopened bottle cannot be thrown away without a reason status first', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Top Coat', sku: 'TC-1' });
    await inv.addStock(manager, pid, { quantity: 1 });
    const [u] = await q(`select id from inventory_units where product_id = $1`, [pid]);
    await expect(inv.dispose(manager, u.id)).rejects.toThrow(/Cannot change bottle/);
    expect(await onHand(pid)).toBe(1);
  });
  it('missing then found: an opened bottle comes back opened, an unopened one unopened, stock restored', async () => {
    const { id: pid } = await inv.createProduct(manager, { name: 'Acetone', sku: 'AC-1' });
    await inv.addStock(manager, pid, { quantity: 2 });
    const [a, b] = await q(`select id from inventory_units where product_id = $1 order by id`, [pid]);
    await inv.openUnit(manager, a.id);
    await inv.markMissing(manager, a.id); await inv.markMissing(manager, b.id);
    expect(await onHand(pid)).toBe(0);
    await inv.markFound(manager, a.id); await inv.markFound(manager, b.id);
    expect(await status(a.id)).toBe('opened');
    expect(await status(b.id)).toBe('unopened');
    expect(await onHand(pid)).toBe(2);
    expect(await moves(pid, 'missing')).toBe(2);
  });
});
