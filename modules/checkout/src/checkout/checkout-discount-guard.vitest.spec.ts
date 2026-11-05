import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError } from './checkout.service';

// applyDiscount feeds the ticket's effective (post-discount) subtotal, which the tax + total are computed from. A
// non-integer discount would make that subtotal fractional and drift the tax/total off whole cents. These lock in
// that a discount must be a non-negative whole number of cents (override_total is granted here so the >50% policy
// guard never masks the amount checks under test).
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.apply_discount', 'pos.checkout.override_total'] };
const TK = 'tk_2042';

describe('applyDiscount — money-integrity guard', () => {
  it('rejects a NEGATIVE discount', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.applyDiscount(ctx, TK, { discountCents: -500 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a FRACTIONAL discount (cent-drift guard)', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    await expect(svc.applyDiscount(ctx, TK, { discountCents: 250.5 } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a valid whole-cent discount and keeps tax + total on whole cents', async () => {
    const svc = new CheckoutService(new InMemoryCheckoutRepository());
    const totals: any = await svc.applyDiscount(ctx, TK, { discountCents: 500 });
    expect(Number.isInteger(totals.taxCents)).toBe(true);
    expect(Number.isInteger(totals.totalDueCents)).toBe(true);
    expect(Number.isInteger(totals.subtotalCents)).toBe(true);
  });
});
