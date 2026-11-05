// inventory-po-edit.pgtest — D9 gaps (Nov 5 2026): a DRAFT purchase order can be changed (lines, shipping, tax, notes) in one
// transaction; an approved one cannot. If it was already sent for approval, the requester's request is withdrawn and a
// new one is filed for the new total; when the withdrawal is not allowed, the change is refused and nothing moves.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InventoryService } from './inventory.service';

const T = 'a71b0000-0000-4000-8000-000000000001', B = 'a71b0000-0000-4000-8000-0000000000b1', UM = 'a71b0000-0000-4000-8000-0000000000e9';
const manager: any = { tenantId: T, branchId: B, userId: UM, role: 'OWNER', permissions: ['*', 'inventory.view', 'inventory.cost.view', 'inventory.vendor.manage', 'inventory.purchase_order.create'] };
let pg: any; let inv: InventoryService;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  inv = new InventoryService(kyselyFor(pg) as any);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'Ed Co','Ed Salon','ed-co','EDCO')`, [T]);
  await q(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await q(`insert into users (id, tenant_id, role, email, full_name) values ($1,$2,'OWNER','o@ed.test','Olive Owner')`, [UM, T]);
}, 180_000);

const fakeApprovals = (cancelOk: boolean) => {
  const calls = { cancel: [] as string[], request: [] as number[] };
  const port: any = {
    registerExecutor() {}, needsApproval: async () => true,
    request: async (_a: any, body: any) => { calls.request.push(body.amountCents); return { request: { id: 'req-' + calls.request.length }, created: true }; },
    liveFor: async () => ({ id: 'req-live', version: 1, status: 'pending' }),
    decide: async () => ({ status: 'approved' }),
    cancel: async (_a: any, id: string) => { if (!cancelOk) throw new Error('Only the person who asked can withdraw a request.'); calls.cancel.push(id); },
  };
  return { port, calls };
};

describe('changing a draft purchase order', () => {
  it('lines and totals are replaced in one go; an approved order cannot be changed', async () => {
    const { id: vendorId } = await inv.createVendor(manager, { name: 'Edit Supply' });
    const { id: p1 } = await inv.createProduct(manager, { name: 'Polish A', sku: 'PA-1' });
    const { id: p2 } = await inv.createProduct(manager, { name: 'Polish B', sku: 'PB-1' });
    const po: any = await inv.createPurchaseOrder(manager, { vendorId, shippingCents: 500, lines: [{ productId: p1, quantityOrdered: 2, unitCostCents: 1000 }] });
    const out: any = await inv.updatePurchaseOrder(manager, po.id, { notes: 'add B', lines: [{ productId: p1, quantityOrdered: 3, unitCostCents: 1000 }, { productId: p2, quantityOrdered: 1, unitCostCents: 250 }] });
    expect(out.lines.length).toBe(2);
    const [h] = await q(`select subtotal_cents, shipping_cents, total_cents, notes from purchase_orders where id = $1`, [po.id]);
    expect(h).toMatchObject({ subtotal_cents: 3250, shipping_cents: 500, total_cents: 3750, notes: 'add B' });
    expect((await q(`select count(*)::int n from audit_logs where action_type = 'inventory_po_updated'`))[0].n).toBe(1);
    await expect(inv.updatePurchaseOrder(manager, po.id, { lines: [{ productId: 'a71b0000-0000-4000-8000-00000000dead', quantityOrdered: 1 }] })).rejects.toThrow();
    expect((await q(`select count(*)::int n from purchase_order_lines where purchase_order_id = $1`, [po.id]))[0].n).toBe(2);   // a bad change leaves the order as it was
    await inv.approvePurchaseOrder(manager, po.id);
    await expect(inv.updatePurchaseOrder(manager, po.id, { lines: [{ productId: p1, quantityOrdered: 1 }] })).rejects.toThrow(/Only a draft/);
  });
  it('sent for approval: the requester withdraws it and a new request carries the new total', async () => {
    const svc = new InventoryService(kyselyFor(pg) as any); const { port, calls } = fakeApprovals(true); svc.useApprovals(port);
    const { id: p1 } = await svc.createProduct(manager, { name: 'Polish C', sku: 'PC-1' });
    const po: any = await svc.createPurchaseOrder(manager, { lines: [{ productId: p1, quantityOrdered: 1, unitCostCents: 1000 }] });
    const out: any = await svc.updatePurchaseOrder(manager, po.id, { lines: [{ productId: p1, quantityOrdered: 4, unitCostCents: 1000 }] });
    expect(calls.cancel).toEqual(['req-live']);
    expect(calls.request.at(-1)).toBe(4000);
    expect(out.approvalId).toBeTruthy();
  });
  it('someone else cannot withdraw the open request: the change is refused and nothing moves', async () => {
    const svc = new InventoryService(kyselyFor(pg) as any); const { port } = fakeApprovals(false); svc.useApprovals(port);
    const { id: p1 } = await svc.createProduct(manager, { name: 'Polish D', sku: 'PD-1' });
    const po: any = await svc.createPurchaseOrder(manager, { lines: [{ productId: p1, quantityOrdered: 1, unitCostCents: 1000 }] });
    await expect(svc.updatePurchaseOrder(manager, po.id, { lines: [{ productId: p1, quantityOrdered: 9, unitCostCents: 1000 }] })).rejects.toThrow(/waiting for approval/);
    expect((await q(`select total_cents from purchase_orders where id = $1`, [po.id]))[0].total_cents).toBe(1000);
  });
});
