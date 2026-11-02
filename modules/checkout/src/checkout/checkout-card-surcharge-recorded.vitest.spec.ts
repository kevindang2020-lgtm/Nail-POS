// checkout-card-surcharge-recorded.vitest.spec.ts — a card payment through a REAL processor records the surcharge it
// charged (wave 4 PILOT, Oct 13 2026).
//
// Found by live-pilot-day.mjs: Jenny's card payment through the salon's CardPointe gateway charged $119.61 including a
// $2.03 card surcharge, but payments.surcharge_cents was 0 — the live path reserves the row with claimPayment, which
// never carried the surcharge (the sandbox path, recordPayment, did). Every surcharge collected through a live gateway
// was missing from the surcharge figures and from what a refund knows was surcharge.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected', cardSurchargeEnabled: true, cardSurchargePercent: 3 } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };
const processor: any = {
  name: 'spy', calls: [] as any[],
  async authorizeAndCapture(input: any) { this.calls.push(input); return { approved: true, retref: 'RET-1', authCode: 'A1', respstat: 'A', respText: 'Approved' }; },
  async voidTransaction(input: any) { return { approved: true, retref: input.retref }; },
  async refund() { return { approved: true }; },
};

describe('payCard through a live processor', () => {
  it('records the card surcharge on the payment it charged', async () => {
    const repo = new ConnectedRepo();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const totals = (await repo.totalsFor(ctx, 'tk_2042', 'card'))!;
    expect(totals.surchargeCents).toBeGreaterThan(0);
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'SUR-1' } as any);
    expect(r.status).toBe('approved');
    const p = (await repo.paymentsForTicket(ctx, 'tk_2042')).find((x) => x.paymentId === r.paymentId)!;
    expect(p.amountCents).toBe(totals.totalDueCents);
    expect(p.surchargeCents).toBe(totals.surchargeCents);
  });
});
