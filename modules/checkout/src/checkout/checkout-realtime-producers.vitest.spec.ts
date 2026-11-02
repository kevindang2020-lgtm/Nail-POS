// checkout-realtime-producers.vitest.spec — Constitution 9 §246: these three events were DECLARED in the registry,
// versioned, routed to the checkout screen and catalogued — and never emitted by anything. A second POS open on the
// same ticket saw nothing. These tests are the reason that cannot recur silently.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { EVENTS } from '@aipowersalon/realtime-contracts';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.receipts.send'] } as CheckoutContext;
const TK = 'tk_2041';

/** Records every realtime push so a test can assert the event NAME that reached the room. */
function spyEmitter() {
  const pushes: Array<{ event: string; payload: any }> = [];
  return {
    pushes,
    emitter: {
      toTenant: (_c: unknown, event: string, payload: unknown) => { pushes.push({ event, payload }); },
      toTechnician: () => {}, toTicket: () => {}, toCustomerDisplay: () => {}, toOwner: () => {}, toCustomer: () => {}, toPlatform: () => {},
    } as never,
  };
}

describe('§246 checkout realtime producers', () => {
  it('recalculate() emits checkout_total_recalculated with the ticket id', async () => {
    const { pushes, emitter } = spyEmitter();
    const svc = new CheckoutService(new InMemoryCheckoutRepository(), undefined, undefined, undefined, undefined, emitter);
    await svc.recalculate(ctx, TK);
    const hit = pushes.find((p) => p.event === EVENTS.checkoutTotalRecalculated);
    expect(hit, `emitted: ${pushes.map((p) => p.event).join(', ') || 'nothing'}`).toBeTruthy();
    expect(hit!.payload).toMatchObject({ ticketId: TK });
  });

  it('a receipt that actually SENDS emits receipt_sent naming the channel', async () => {
    const { pushes, emitter } = spyEmitter();
    const sms = { send: async () => ({ sid: 'SM_test' }) };                      // configured: the send path runs
    const svc = new CheckoutService(new InMemoryCheckoutRepository(), sms, undefined, undefined, undefined, emitter);
    const res: any = await svc.receiptSms(ctx, TK);
    expect(res.configured).toBe(true);                                           // the send really happened
    const hit = pushes.find((p) => p.event === EVENTS.receiptSent);
    expect(hit, `emitted: ${pushes.map((p) => p.event).join(', ') || 'nothing'}`).toBeTruthy();
    expect(hit!.payload).toMatchObject({ ticketId: TK, channel: 'sms' });
  });

  it('a receipt that CANNOT send (no sender configured) emits nothing — a not_configured return must not claim a receipt went out', async () => {
    const { pushes, emitter } = spyEmitter();
    const svc = new CheckoutService(new InMemoryCheckoutRepository(), undefined, undefined, undefined, undefined, emitter);
    const res: any = await svc.receiptSms(ctx, TK);
    expect(res.configured).toBe(false);
    expect(pushes.filter((p) => p.event === EVENTS.receiptSent)).toEqual([]);
  });

  it('every checkout push uses a REGISTRY event name — no invented vocabulary (§25/§26)', async () => {
    const { pushes, emitter } = spyEmitter();
    const svc = new CheckoutService(new InMemoryCheckoutRepository(), undefined, undefined, undefined, undefined, emitter);
    await svc.recalculate(ctx, TK);
    await svc.receiptSms(ctx, TK).catch(() => {});
    expect(pushes.length).toBeGreaterThan(0);                                    // not a vacuous pass
    const known = new Set<string>(Object.values(EVENTS));
    for (const p of pushes) expect(known.has(p.event), `unregistered event "${p.event}"`).toBe(true);
  });
});
