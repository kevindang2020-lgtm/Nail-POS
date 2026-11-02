// raw-card-refusal.vitest.spec.ts — wave 3 PAYI §29–§31 (P0 PCI, defense in depth): a raw card number (Luhn-valid,
// 13–19 digits, not CardSecure's 9-prefix) presented as a card "token" is REFUSED before any processor call — on the POS
// card path, the POS split path and the customer app's Skip-the-Line confirm (which, before this wave, the customer web
// app fed with the typed digits). A CardSecure token (9…) still charges.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { SkipLineCheckoutService } from '../skip-line-checkout/skip-line-checkout.service';

const PAN = '4111111111111111', TOKEN = '9418594164541111';
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected' } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.split_payment'] };
const spyProcessor = () => { const calls: any[] = []; return { calls, p: { name: 'spy', async authorizeAndCapture(i: any) { calls.push(i); return { approved: true, retref: 'RET-1', authCode: 'A', respstat: 'A', respText: 'Approved' }; }, async voidTransaction() { return { ok: true }; }, async refund() { return { ok: true }; } } as any }; };

describe('POS card path refuses a raw card number (§31)', () => {
  it('payCard with a PAN as cardToken → refused, the processor is never called', async () => {
    const { calls, p } = spyProcessor();
    const svc = new CheckoutService(new ConnectedRepo(), undefined, undefined, p);
    await expect(svc.payCard(ctx, 'tk_2042', { cardToken: PAN, idempotencyKey: 'R1' } as any)).rejects.toThrow(/card number/i);
    expect(calls).toHaveLength(0);
  });
  it('payCard with a CardSecure token still charges', async () => {
    const { calls, p } = spyProcessor();
    const svc = new CheckoutService(new ConnectedRepo(), undefined, undefined, p);
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: TOKEN, idempotencyKey: 'R2' } as any);
    expect(r.status).toBe('approved'); expect(calls).toHaveLength(1);
  });
});

describe('Skip-the-Line confirm refuses a raw card number (§31)', () => {
  beforeEach(() => { process.env.PAYMENTS_SANDBOX = '1'; });
  it('a PAN in the confirm body is a 400 raw_card_rejected; nothing is charged or recorded', async () => {
    const repo: any = {
      resolveCustomerId: vi.fn().mockResolvedValue('c1'),
      getSettings: vi.fn().mockResolvedValue({ featureEnabled: true }),
      billForTicket: vi.fn().mockResolvedValue({ ticketId: 'tk1', invoiceId: 'tk1', customerId: 'c1', subtotalCents: 8000, tipCents: 0, totalDueCents: 8650, paid: false, ticketStatus: 'ready' }),
      maxTipPercent: vi.fn().mockResolvedValue(50),
      createIntent: vi.fn().mockResolvedValue({ id: 'i1', ticket_id: 'tk1' }), getIntent: vi.fn().mockResolvedValue(null), setIntentStatus: vi.fn(),
      savedCardToken: vi.fn().mockResolvedValue(null), recordDeclinedPayment: vi.fn(), recordPaymentAndCloseTicket: vi.fn(), audit: vi.fn(),
    };
    const svc = new SkipLineCheckoutService(repo);
    await expect(svc.confirmAppPayment({ tenantId: 't1', branchId: 'b1', userId: 'u1' } as any, 'tk1', { method: 'card', token: PAN, expiry: '1230' }))
      .rejects.toMatchObject({ code: 'raw_card_rejected', httpStatus: 400 });
    expect(repo.recordPaymentAndCloseTicket).not.toHaveBeenCalled();
    expect(repo.recordDeclinedPayment).not.toHaveBeenCalled();
  });
});
