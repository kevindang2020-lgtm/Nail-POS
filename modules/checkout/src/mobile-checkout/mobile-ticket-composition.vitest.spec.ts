// mobile-ticket-composition.vitest.spec.ts — the TapPay prototype's "Add Retail Product" / "Add Discount",
// wired as THIN DELEGATES to the canonical engines (Jul 28, 2026). The rule under test: the mobile app never
// re-implements composition — prices come from the tenant catalog via ServingService, discounts go through
// CheckoutService.applyDiscount, and a build without the serving engine says so instead of pretending.
import { describe, it, expect, vi } from 'vitest';
import { MobileCheckoutService } from './mobile-checkout.service';

const mk = (over: { serving?: any; checkout?: any } = {}) =>
  new MobileCheckoutService(undefined as any, {} as any, (over.checkout ?? {}) as any, {} as any, {} as any, undefined, undefined, undefined, over.serving);

describe('mobile ticket composition — thin delegates to the canonical engines', () => {
  it('retailCatalog forwards ctx + search to ServingService', async () => {
    const serving = { retailCatalog: vi.fn().mockResolvedValue({ products: [{ productId: 'p1' }] }) };
    const r = await mk({ serving }).retailCatalog({ tenantId: 't1' } as any, 'gel');
    expect(serving.retailCatalog).toHaveBeenCalledWith({ tenantId: 't1' }, 'gel');
    expect(r).toEqual({ products: [{ productId: 'p1' }] });
  });

  it('addRetailToTicket forwards productId + quantity and NOTHING price-shaped (a client cannot name its own price)', async () => {
    const serving = { addRetail: vi.fn().mockResolvedValue({ ok: true }) };
    await mk({ serving }).addRetailToTicket({ tenantId: 't1' } as any, 'tk1', { productId: 'p1', quantity: 2, unitPriceCents: 1, priceCents: 1 } as any);
    expect(serving.addRetail).toHaveBeenCalledWith({ tenantId: 't1' }, 'tk1', { productId: 'p1', quantity: 2 });
  });

  it('applyTicketDiscount goes through checkout.applyDiscount with integer cents + reason', async () => {
    const checkout = { applyDiscount: vi.fn().mockResolvedValue({ ok: true }) };
    await mk({ checkout }).applyTicketDiscount({ tenantId: 't1' } as any, 'tk1', { discountCents: 500, reason: 'loyal guest' });
    expect(checkout.applyDiscount).toHaveBeenCalledWith({ tenantId: 't1' }, 'tk1', { discountCents: 500, reason: 'loyal guest', managerPin: undefined });
  });

  it('junk discount input becomes 0 cents for the ENGINE to reject — never NaN', async () => {
    const checkout = { applyDiscount: vi.fn().mockResolvedValue({ ok: false }) };
    await mk({ checkout }).applyTicketDiscount({} as any, 'tk1', { discountCents: Number('abc') });
    expect(checkout.applyDiscount.mock.calls[0][2].discountCents).toBe(0);
  });

  it('a build without the serving engine says so honestly instead of crashing or pretending', async () => {
    await expect(mk().retailCatalog({} as any)).rejects.toThrow(/not available/i);
    await expect(mk().addRetailToTicket({} as any, 'tk1', { productId: 'p1' })).rejects.toThrow(/not available/i);
  });
});
