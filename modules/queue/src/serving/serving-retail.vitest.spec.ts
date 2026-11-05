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

  it('allows retail sale of strict product if manager override permission is present and pin is provided', async () => {
    const overrideCtx = { ...ctx(), permissions: [...ctx().permissions, 'pos.checkout.override_inventory'] };
    const r = await svc.addRetail(overrideCtx, ticketId, { productId: 'p_strict', quantity: 1, managerPin: '1234' });
    expect(r).toMatchObject({
      ok: true,
      productName: 'Strict Product',
      unitPriceCents: 1000,
    });
  });
});
