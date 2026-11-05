import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { splitCardSurchargeCents } from './checkout-display.dto';
import { buildIdempotencyKey } from './checkout.dto';

// Build A — "Option A": a split tender surcharges the CARD PORTION only. These tests lock in that the customer is
// actually charged the surcharge on the card dollars of a split (closing the prior loophole where splitting avoided it),
// that cash/gift dollars are never surcharged, and that the recorded card payment + returned total reflect it.

// A spy processor that records the exact amount it was asked to capture.
function makeProcessor() {
  const calls = { capture: 0, lastAmount: 0, lastIdempotencyKey: undefined as string | undefined };
  const processor: any = {
    name: 'spy-processor',
    async authorizeAndCapture(input: any) { calls.capture++; calls.lastAmount = input.amountCents; calls.lastIdempotencyKey = input.idempotencyKey; return { approved: true, retref: 'RET-999', authCode: 'A1', respstat: 'A', respText: 'Approved' }; },
    async voidTransaction(input: any) { return { approved: true, retref: input.retref }; },
    async refund() { return { approved: true }; },
  };
  return { processor, calls };
}

// Connected card processor. surcharge=true keeps the default 3% surcharge on; surcharge=false disables it.
class ConnectedRepo extends InMemoryCheckoutRepository {
  constructor(private surchargeOn = true) { super(); }
  async settings(ctx: CheckoutContext) {
    const s = await super.settings(ctx);
    return { ...s, fiservStatus: 'connected', cardSurchargeEnabled: this.surchargeOn } as any;
  }
}

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.split_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.cash_payment', 'pos.checkout.add_tip'] };
const pct = (n: number) => Math.round(n * 0.03); // default 3%

describe('splitCardSurchargeCents (pure helper)', () => {
  it('surcharges the card base at the configured percent when enabled', () => {
    expect(splitCardSurchargeCents(10000, true, 3)).toBe(300);
    expect(splitCardSurchargeCents(9000, true, 3)).toBe(270);
  });
  it('rounds to the nearest cent', () => {
    expect(splitCardSurchargeCents(333, true, 3)).toBe(10);   // 9.99 -> 10
    expect(splitCardSurchargeCents(1650, true, 3)).toBe(50);  // 49.5 -> 50
  });
  it('returns 0 when disabled, zero percent, or no card dollars', () => {
    expect(splitCardSurchargeCents(10000, false, 3)).toBe(0);
    expect(splitCardSurchargeCents(10000, true, 0)).toBe(0);
    expect(splitCardSurchargeCents(0, true, 3)).toBe(0);
    expect(splitCardSurchargeCents(-100, true, 3)).toBe(0);
  });
});

describe('paySplit — card-portion surcharge (Option A)', () => {
  it('passes an idempotency key on the split card capture so the processor can dedupe a retry', async () => {
    const repo = new ConnectedRepo(true);
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const cash = 2000;
    await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: due - cash }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);
    expect(typeof calls.lastIdempotencyKey).toBe('string');
    expect((calls.lastIdempotencyKey || '').length).toBeGreaterThan(0);
  });

  it('a concurrent split with the same card charge does NOT double-capture (claim-first via payment_attempts)', async () => {
    const repo = new ConnectedRepo(true);
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const cash = 2000;
    const cardBase = due - cash;
    const cardCharge = cardBase + pct(cardBase);
    // Simulate a winner that has already reserved this exact split card charge (mid-flight):
    const claim = await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: cardCharge, idempotencyKey: buildIdempotencyKey('tk_2043', 'card', cardCharge) });
    expect(claim.claimed).toBe(true);
    // A concurrent split with the same card charge must refuse without touching the gateway:
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any)).rejects.toThrow(/already being processed/i);
    expect(calls.capture).toBe(0);
  });

  it('claimPaymentAttempt: a second claim with the same key fails in flight; release frees it', async () => {
    const repo = new ConnectedRepo(true);
    const a = await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: 5000, idempotencyKey: 'ATT-1' });
    const b = await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: 5000, idempotencyKey: 'ATT-1' });
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(false);
    await repo.releasePaymentAttempt(ctx, 'ATT-1');
    const c = await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: 5000, idempotencyKey: 'ATT-1' });
    expect(c.claimed).toBe(true); // released → re-claimable
  });

  it('captures and records base card dollars PLUS the surcharge; cash is untouched', async () => {
    const repo = new ConnectedRepo(true);
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const cash = 2000;
    const cardBase = due - cash;
    const expectedSurcharge = pct(cardBase);

    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);

    expect(res.status).toBe('paid');
    expect(res.cardSurchargeCents).toBe(expectedSurcharge);
    // the gateway was asked to capture the base card dollars + surcharge (NOT just the base)
    expect(calls.capture).toBe(1);
    expect(calls.lastAmount).toBe(cardBase + expectedSurcharge);
    // the recorded card payment row carries the surcharge-inclusive amount; the cash row is unchanged
    const cardRow = res.payments.find((p: any) => p.method === 'card');
    const cashRow = res.payments.find((p: any) => p.method === 'cash');
    expect(cardRow.amountCents).toBe(cardBase + expectedSurcharge);
    expect(cashRow.amountCents).toBe(cash);
  });

  it('rejects a split with two card segments (and never charges the processor)', async () => {
    const repo = new ConnectedRepo(true);
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const half = Math.floor(due / 2);
    // two card segments would otherwise capture only the first → the second card dollars are never collected
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: half }, { method: 'card', amountCents: due - half }], cardToken: 'tok' } as any)).rejects.toThrow(/at most one card segment/i);
    expect(calls.capture).toBe(0); // nothing was charged
  });

  it('charges NO surcharge when card surcharge is disabled', async () => {
    const repo = new ConnectedRepo(false);
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const cash = 2000;
    const cardBase = due - cash;

    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);

    expect(res.cardSurchargeCents).toBe(0);
    expect(calls.lastAmount).toBe(cardBase); // base only
    const cardRow = res.payments.find((p: any) => p.method === 'card');
    expect(cardRow.amountCents).toBe(cardBase);
  });

  it('owes no surcharge for a fully cash split (no card dollars)', async () => {
    const repo = new ConnectedRepo(true);
    const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;

    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'cash', amountCents: due }] } as any);
    expect(res.cardSurchargeCents).toBe(0);
  });
});

describe('checkout KPIs — surcharge + tax collected today (no longer hardcoded 0)', () => {
  it('reports the surcharge + tax actually collected on a straight card payment', async () => {
    const repo = new ConnectedRepo(true);
    const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const cardTotals = (await repo.totalsFor(ctx, 'tk_2043', 'card'))!;

    await svc.payCard(ctx, 'tk_2043', { cardToken: 'tok' } as any);
    const kpis = await svc.getKpis(ctx);

    expect(kpis.cardSurchargeCollectedCents).toBe(cardTotals.surchargeCents);
    expect(kpis.cardSurchargeCollectedCents).toBeGreaterThan(0); // 3% of a non-trivial ticket
    expect(kpis.taxCollectedCents).toBe(cardTotals.taxCents);
    expect(kpis.taxCollectedCents).toBeGreaterThan(0);
  });

  it('includes the card-portion surcharge from a split in the collected total', async () => {
    const repo = new ConnectedRepo(true);
    const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const expectedTax = (await repo.totalsFor(ctx, 'tk_2043', 'cash'))!.taxCents; // tax is method-independent
    const cash = 2000;
    const cardBase = due - cash;
    const expectedSurcharge = pct(cardBase);

    await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);
    const kpis = await svc.getKpis(ctx);

    expect(kpis.cardSurchargeCollectedCents).toBe(expectedSurcharge);
    expect(kpis.taxCollectedCents).toBe(expectedTax);
  });

  it('reports 0 surcharge collected for a fully cash payment', async () => {
    const repo = new ConnectedRepo(true);
    const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const cashTotals = (await repo.totalsFor(ctx, 'tk_2043', 'cash'))!;

    await svc.payCash(ctx, 'tk_2043', { amountReceivedCents: cashTotals.totalDueCents } as any);
    const kpis = await svc.getKpis(ctx);

    expect(kpis.cardSurchargeCollectedCents).toBe(0);
    expect(kpis.taxCollectedCents).toBe(cashTotals.taxCents); // tax still collected on cash
  });
});

describe('surcharge compliance — network cap + funding exclusion', () => {
  it('hard-caps the applied rate at 3% even when a tenant mis-configures a higher percent', () => {
    expect(splitCardSurchargeCents(10000, true, 5)).toBe(300);   // 5% configured → 3% applied
    expect(splitCardSurchargeCents(10000, true, 3)).toBe(300);   // at the cap, unchanged
    expect(splitCardSurchargeCents(10000, true, 2.5)).toBe(250); // below the cap, tenant rate honored
  });
  it('never surcharges debit or prepaid cards when the processor reports funding', () => {
    expect(splitCardSurchargeCents(10000, true, 3, 'debit')).toBe(0);
    expect(splitCardSurchargeCents(10000, true, 3, 'prepaid')).toBe(0);
    expect(splitCardSurchargeCents(10000, true, 3, 'credit')).toBe(300);
    expect(splitCardSurchargeCents(10000, true, 3, 'unknown')).toBe(300); // pre-processor behavior unchanged
  });
});
