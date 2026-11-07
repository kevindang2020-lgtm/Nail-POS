// checkout-card-surcharge-recorded.vitest.spec.ts — a card payment through a REAL processor records the surcharge the
// PROVIDER assessed (Fiserv master build §9, Nov 4 2026).
//
// History: wave 4 (Oct 13) fixed payments.surcharge_cents being 0 on the live path, but recorded a LOCALLY computed 3%.
// Now the authorization is the base amount and the recorded surcharge is the provider's fee_amount — never a POS
// estimate. An approval whose amount does not equal base + provider fee is held as 'processing', never "paid".
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected', cardSurchargeEnabled: true, cardSurchargePercent: 3 } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };
const proc = (result: (input: any) => any): any => ({
  name: 'spy', calls: [] as any[],
  async authorizeAndCapture(input: any) { this.calls.push(input); return result(input); },
  async voidTransaction(input: any) { return { ok: true, retref: input.retref, respstat: 'A', respText: '' }; },
  async refund() { return { ok: true, respstat: 'A', respText: '' }; },
});

describe('payCard through a live processor — provider-assessed surcharge', () => {
  it('authorizes the base amount and records the provider fee (amount = base + fee, surcharge = fee)', async () => {
    const repo = new ConnectedRepo();
    const p = proc((i) => ({ approved: true, declined: false, retref: 'RET-1', authCode: 'A1', respstat: 'A', respText: 'Approved', amountCents: i.amountCents + 300, surchargeCents: 300, feeType: 'SURCHRG', feeValue: '300' }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    const totals = (await repo.totalsFor(ctx, 'tk_2042', 'card'))!;
    expect(totals.surchargeCents).toBe(0);                                  // no local fee in the total
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'SUR-1' } as any);
    expect(p.calls[0].amountCents).toBe(totals.totalDueCents);              // asked for the base
    expect(r).toMatchObject({ status: 'approved', approvedAmountCents: totals.totalDueCents + 300 });
    const pay = (await repo.paymentsForTicket(ctx, 'tk_2042')).find((x) => x.paymentId === r.paymentId)!;
    expect(pay.amountCents).toBe(totals.totalDueCents + 300);
    expect(pay.surchargeCents).toBe(300);
  });

  it('no provider fee (not enrolled / debit / waived) → surcharge 0, amount = base', async () => {
    const repo = new ConnectedRepo();
    const p = proc((i) => ({ approved: true, declined: false, retref: 'RET-2', respstat: 'A', respText: 'Approved', amountCents: i.amountCents }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    const totals = (await repo.totalsFor(ctx, 'tk_2042', 'card'))!;
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'SUR-2' } as any);
    const pay = (await repo.paymentsForTicket(ctx, 'tk_2042')).find((x) => x.paymentId === r.paymentId)!;
    expect(pay.amountCents).toBe(totals.totalDueCents);
    expect(pay.surchargeCents ?? 0).toBe(0);
  });

  it('approved for an amount that is not base + provider fee → held "processing", ticket not paid', async () => {
    const repo = new ConnectedRepo();
    const p = proc(() => ({ approved: true, declined: false, retref: 'RET-3', respstat: 'A', respText: 'Approved', amountCents: 1 }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'SUR-3' } as any);
    expect(r.status).toBe('processing');
    expect(r.message).toMatch(/does not match/);
    const pay = (await repo.paymentsForTicket(ctx, 'tk_2042')).find((x) => x.paymentId === r.paymentId)!;
    expect(pay.status).toBe('processing');
  });
});
