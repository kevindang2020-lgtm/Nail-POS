// serving-retail.vitest.spec.ts — the retail sale write path (Jul 27, 2026).
//
// Everything downstream of a retail sale already existed: line_kind='retail' (mig 131), the compensation engine's
// separate retail-commission treatment, Checkout's retail/upsell reporting, inventory's 'retail_sale' movement
// type. What did not exist was any way to WRITE one — the only line writer inserts a service line, and
// ticket_service_lines.service_id was NOT NULL with no product column. Migration 423 + this path close that.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryServingRepository, type ServingContext } from './serving.repository';
import { ServingService, ValidationError } from './serving.service';

const PERMS = ['pos.serving.view', 'pos.serving.start', 'pos.serving.edit_services', 'pos.serving.mark_done'];
const ctx = (): ServingContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS });

let repo: InMemoryServingRepository;
let svc: ServingService;
let ticketId: string;

beforeEach(async () => {
  repo = new InMemoryServingRepository();
  svc = new ServingService(repo);
  repo.retailProducts.set('p_polish', { productId: 'p_polish', name: 'Gel Polish — Rose', retailPriceCents: 1499, allowNegativeStock: true, onHand: 10 });
  repo.retailProducts.set('p_strict', { productId: 'p_strict', name: 'Strict Product', retailPriceCents: 1000, allowNegativeStock: false, onHand: 0 });
  ticketId = 'sv_4001';                   // seeded by InMemoryServingRepository for tenant luxe001
  expect(await repo.ticket(ctx(), ticketId)).toBeTruthy();
});

describe('retail sale', () => {
  it('prices the line from the salon catalog, never from the request', async () => {
    // The body names a product and a quantity — deliberately NOT a price. A client cannot set its own price.
    const r = await svc.addRetail(ctx(), ticketId, { productId: 'p_polish', quantity: 2, unitPriceCents: 1 } as any);
    expect(r.ok).toBe(true);
    expect(r.unitPriceCents).toBe(1499);                 // catalog price won
    expect(r.lineTotalCents).toBe(1499 * 2);             // integer cents, no float math
    expect(r.productName).toBe('Gel Polish — Rose');
  });

  it('defaults to a quantity of one and adds NO duration to the appointment', async () => {
    const before: any = await repo.ticket(ctx(), ticketId);
    const r = await svc.addRetail(ctx(), ticketId, { productId: 'p_polish' });
    expect(r.quantity).toBe(1);
    const after: any = await repo.ticket(ctx(), ticketId);
    // Selling a bottle of polish must not push the appointment's estimate out.
    expect(after.estimatedDurationMinutes).toBe(before.estimatedDurationMinutes);
    expect(after.lines.some((l: any) => l.serviceName === 'Gel Polish — Rose')).toBe(true);
  });

  it('refuses a product that is not sellable, and says why', async () => {
    await expect(svc.addRetail(ctx(), ticketId, { productId: 'p_unknown' }))
      .rejects.toThrow(/not available for retail sale/i);
  });

  it('refuses a missing product and out-of-range quantities instead of writing a junk line', async () => {
    await expect(svc.addRetail(ctx(), ticketId, {})).rejects.toThrow(ValidationError);
    await expect(svc.addRetail(ctx(), ticketId, { productId: 'p_polish', quantity: 0 })).rejects.toThrow(/Quantity/i);
    await expect(svc.addRetail(ctx(), ticketId, { productId: 'p_polish', quantity: 100 })).rejects.toThrow(/Quantity/i);
    await expect(svc.addRetail(ctx(), ticketId, { productId: 'p_polish', quantity: 2.5 as any })).rejects.toThrow(/Quantity/i);
  });

  it('refuses an unknown ticket', async () => {
    await expect(svc.addRetail(ctx(), 'tk_does_not_exist', { productId: 'p_polish' }))
      .rejects.toThrow(/Ticket not found/);
  });

  it('blocks retail sale if product has zero stock and allowNegativeStock is false', async () => {
    await expect(svc.addRetail(ctx(), ticketId, { productId: 'p_strict', quantity: 1 }))
      .rejects.toThrow(/Insufficient stock/);
  });

  // B-19 (Oct 22 2026): the override is a MANAGER's — the signed-in holder of the permission, or a manager's PIN at the till —
  // and it is audited. The front desk alone is refused with a code the POS turns into the PIN prompt.
  it('refuses the front desk with INSUFFICIENT_STOCK and the counts (the POS asks for a manager PIN)', async () => {
    const e: any = await svc.addRetail(ctx(), ticketId, { productId: 'p_strict', quantity: 2 }).catch((x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.code).toBe('INSUFFICIENT_STOCK');
    expect(e.details).toMatchObject({ onHand: 0, quantity: 2, shortBy: 2, managerOverride: 'pin_or_permission' });
  });
  it('a signed-in holder of pos.checkout.override_inventory (→ checkout.manage_overrides, a MANAGER) sells it — audited as her override', async () => {
    const manager = { ...ctx(), userId: 'u_mgr', role: 'MANAGER', permissions: [...ctx().permissions, 'checkout.manage_overrides'] };
    const r = await svc.addRetail(manager, ticketId, { productId: 'p_strict', quantity: 1 });
    expect(r).toMatchObject({ ok: true, productName: 'Strict Product', unitPriceCents: 1000 });
    const a = svc.audit.find((x) => x.actionType === 'manager_override_used');
    expect(a?.metadata).toMatchObject({ action: 'inventory.negative_stock', by: 'session', managerUserId: 'u_mgr', productId: 'p_strict', onHand: 0, quantity: 1, shortBy: 1 });
  });
  it('the front desk with a MANAGER\'s PIN sells it — audited with the manager who allowed it; a wrong PIN is refused', async () => {
    const pins = { verify: async (_c: unknown, pin: string) => (pin === '4321' ? { userId: 'u_mgr', name: 'Mai Manager' } : null) };
    const withPins = new ServingService(repo, undefined, undefined, null, pins);
    await expect(withPins.addRetail(ctx(), ticketId, { productId: 'p_strict', quantity: 1, managerPin: '0000' })).rejects.toThrow(/Manager PIN not recognised/);
    const r = await withPins.addRetail(ctx(), ticketId, { productId: 'p_strict', quantity: 1, managerPin: '4321' });
    expect(r).toMatchObject({ ok: true, productName: 'Strict Product' });
    const a = withPins.audit.find((x) => x.actionType === 'manager_override_used');
    expect(a?.metadata).toMatchObject({ action: 'inventory.negative_stock', by: 'manager_pin', managerUserId: 'u_mgr', managerName: 'Mai Manager' });
    expect(a?.userId).toBe('u_owner');   // the row is the front desk's action, allowed by the manager named in it
  });
  it('a PIN with no PIN port bound (no database) is never recognised — the permission is the only way', async () => {
    await expect(svc.addRetail(ctx(), ticketId, { productId: 'p_strict', quantity: 1, managerPin: '4321' })).rejects.toThrow(/Manager PIN not recognised/);
  });
});

// B-17 (Oct 20 2026): the units a retail line took come back when the line is removed; the sale stamps the line id.
describe('retail stock follows the line both ways (B-17)', () => {
  const stockPort = () => {
    const calls: any[] = [];
    return { calls, port: {
      recordRetailSale: async (_c: any, productId: string, quantity: number, ticketId?: string, lineId?: string) => { calls.push(['sale', productId, quantity, ticketId, lineId]); return { consumed: quantity, shortBy: 0, onHand: 10 - quantity }; },
      reverseRetailSale: async (_c: any, input: any) => { calls.push(['reverse', input]); return { returned: 2, byProduct: [] }; },
    } };
  };
  it('the sale carries the line id; removing the line reverses exactly that line', async () => {
    const stock = stockPort(); const s = new ServingService(repo, undefined, stock.port);
    const r = await s.addRetail(ctx(), ticketId, { productId: 'p_polish', quantity: 2 });
    expect(stock.calls).toEqual([['sale', 'p_polish', 2, ticketId, r.serviceLineId]]);
    await s.removeService(ctx(), ticketId, { serviceLineId: r.serviceLineId, reason: 'changed her mind' } as any);
    expect(stock.calls[1]).toEqual(['reverse', { ticketId, lineIds: [r.serviceLineId], reason: 'line removed: changed her mind' }]);
  });
  it('round 11 (ADD-ONS 06): removing a line also asks for its add-on recipe use back; a failing return never fails the removal', async () => {
    const calls: any[] = [];
    const s = new ServingService(repo, undefined, { recordRetailSale: async () => ({ consumed: 1, shortBy: 0, onHand: 9 }), reverseAddOnUsage: async (_c: any, input: any) => { calls.push(input); return { returnedLines: 1 }; } });
    const r = await s.addRetail(ctx(), ticketId, { productId: 'p_polish' });
    await s.removeService(ctx(), ticketId, { serviceLineId: r.serviceLineId, reason: 'wrong add-on' } as any);
    expect(calls).toEqual([{ ticketId, lineIds: [r.serviceLineId], reason: 'line removed: wrong add-on' }]);
    const failing = new ServingService(repo, undefined, { recordRetailSale: async () => ({ consumed: 1, shortBy: 0, onHand: 9 }), reverseAddOnUsage: async () => { throw new Error('inventory down'); } });
    const r2 = await failing.addRetail(ctx(), ticketId, { productId: 'p_polish' });
    await expect(failing.removeService(ctx(), ticketId, { serviceLineId: r2.serviceLineId, reason: 'x' } as any)).resolves.toBeTruthy();
  });
  it('a stock adapter without reverseRetailSale, or one that fails, never fails the removal', async () => {
    const s = new ServingService(repo, undefined, { recordRetailSale: async () => ({ consumed: 1, shortBy: 0, onHand: 9 }) });
    const r = await s.addRetail(ctx(), ticketId, { productId: 'p_polish' });
    await expect(s.removeService(ctx(), ticketId, { serviceLineId: r.serviceLineId, reason: 'x' } as any)).resolves.toBeTruthy();
    const failing = new ServingService(repo, undefined, { recordRetailSale: async () => ({ consumed: 1, shortBy: 0, onHand: 9 }), reverseRetailSale: async () => { throw new Error('inventory down'); } });
    const r2 = await failing.addRetail(ctx(), ticketId, { productId: 'p_polish' });
    await expect(failing.removeService(ctx(), ticketId, { serviceLineId: r2.serviceLineId, reason: 'x' } as any)).resolves.toBeTruthy();
  });
});
