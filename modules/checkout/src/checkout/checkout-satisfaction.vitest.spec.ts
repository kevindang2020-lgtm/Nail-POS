import { describe, it, expect, beforeEach } from 'vitest';
import { CheckoutService, ValidationError, ForbiddenError } from './checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';

// Guest satisfaction capture (POST /pos/checkout/tickets/:id/rating -> svc.recordSatisfaction):
//  • a valid 1–5 score is accepted, rounded to an integer, and persisted;
//  • out-of-range (0, 6) and non-finite (NaN) scores are rejected with ValidationError, not silently clamped;
//  • an unknown ticket is a ValidationError (ticket-not-found), not a silent success;
//  • the permission gate ('pos.checkout.view') is enforced (missing -> ForbiddenError).
const owner = (over: Partial<CheckoutContext> = {}): CheckoutContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view'], ...over });
const svc = () => new CheckoutService(new InMemoryCheckoutRepository());

describe('checkout satisfaction capture', () => {
  let s: CheckoutService;
  beforeEach(() => { s = svc(); });

  it('accepts a valid score and rounds to an integer', async () => {
    expect((await s.recordSatisfaction(owner(), 'tk_2041', 5)).rating).toBe(5);
    expect((await s.recordSatisfaction(owner(), 'tk_2041', 3.4)).rating).toBe(3);
    expect((await s.recordSatisfaction(owner(), 'tk_2041', 4.6)).rating).toBe(5);
  });

  it('rejects out-of-range and non-finite scores', async () => {
    await expect(s.recordSatisfaction(owner(), 'tk_2041', 0)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.recordSatisfaction(owner(), 'tk_2041', 6)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.recordSatisfaction(owner(), 'tk_2041', Number.NaN)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown ticket', async () => {
    await expect(s.recordSatisfaction(owner(), 'tk_does_not_exist', 5)).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces the checkout-view permission', async () => {
    await expect(s.recordSatisfaction(owner({ permissions: [] }), 'tk_2041', 5)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
