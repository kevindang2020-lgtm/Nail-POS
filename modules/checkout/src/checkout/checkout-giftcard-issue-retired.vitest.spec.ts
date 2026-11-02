// Oct 28 2026 (Platform Architecture mandate audit, §142 / §226): POST /pos/checkout/gift-cards minted an ACTIVE, funded
// gift card with no payment under a permission the front desk holds. It is retired (410 ENDPOINT_RETIRED) and never
// reaches the service; a card is sold payment-first on a ticket.
import { describe, it, expect } from 'vitest';
import { CheckoutController } from './checkout.controller';

describe('the unpaid gift-card issue route is retired', () => {
  it('answers 410 ENDPOINT_RETIRED and never calls the service (no card, no balance)', () => {
    let called = false;
    const svc: any = new Proxy({}, { get: () => () => { called = true; return { code: 'GC-X', balanceCents: 10000 }; } });
    const ctl = new CheckoutController(svc);
    let err: any = null;
    try { (ctl as any).issueGift({ ctx: { tenantId: 't1', role: 'FRONT_DESK' } }, { amountCents: 10000 }); } catch (e) { err = e; }
    expect(err?.getStatus?.()).toBe(410);
    expect(err?.getResponse?.()).toMatchObject({ code: 'ENDPOINT_RETIRED' });
    expect(called).toBe(false);
  });
});
