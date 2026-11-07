import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
import { splitCardSurchargeCents, computeTotals, DEFAULT_CHECKOUT_SETTINGS } from './checkout-display.dto';
import { buildIdempotencyKey } from './checkout.dto';

// Fiserv master build §9 (P0, Nov 4 2026) — the surcharge is PROVIDER-ASSESSED.
//
// The former "Option A" added a locally computed 3% to the card authorization (even when card funding was unknown), and
// these tests asserted exactly that. Under the Fiserv Merchant Surcharge Program the provider adds its own fee to eligible
// credit cards, so the local fee could double-surcharge, and it surcharged cards never known to be credit. Now:
//   • the card segment is authorized at its BASE amount only;
//   • the only surcharge recorded is the provider's fee_amount (AuthorizeResult.surchargeCents);
//   • unknown / debit / prepaid funding is never surcharged locally; cash and gift dollars never are;
//   • an approval for an amount other than base + provider fee is not recorded as paid.

/** A spy processor. `fee` simulates the provider-assessed surcharge it returns; `approvedOverride` a contradictory amount. */
function makeProcessor(opts: { fee?: number; feeType?: string; approvedOverride?: number } = {}) {
  const calls = { capture: 0, lastAmount: 0, lastIdempotencyKey: undefined as string | undefined };
  const processor: any = {
    name: 'spy-processor',
    async authorizeAndCapture(input: any) {
      calls.capture++; calls.lastAmount = input.amountCents; calls.lastIdempotencyKey = input.idempotencyKey;
      const fee = opts.fee ?? 0;
      return { approved: true, declined: false, retref: 'RET-999', authCode: 'A1', respstat: 'A', respText: 'Approved',
        amountCents: opts.approvedOverride ?? input.amountCents + fee, ...(opts.fee != null ? { surchargeCents: fee, feeType: opts.feeType ?? 'SURCHRG', feeValue: '300' } : {}) };
    },
    async voidTransaction(input: any) { return { ok: true, retref: input.retref, respstat: 'A', respText: '' }; },
    async refund() { return { ok: true, respstat: 'A', respText: '' }; },
  };
  return { processor, calls };
}

class ConnectedRepo extends InMemoryCheckoutRepository {
  constructor(private surchargeOn = true) { super(); }
  async settings(ctx: CheckoutContext) {
    const s = await super.settings(ctx);
    return { ...s, fiservStatus: 'connected', cardSurchargeEnabled: this.surchargeOn, cardSurchargePercent: 3 } as any;
  }
}

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.split_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.cash_payment', 'pos.checkout.add_tip'] };

describe('splitCardSurchargeCents — disclosure ESTIMATE only, never charged', () => {
  it('unknown funding (the default) is NOT presumed credit → 0', () => {
    expect(splitCardSurchargeCents(10000, true, 3)).toBe(0);
    expect(splitCardSurchargeCents(10000, true, 3, 'unknown')).toBe(0);
  });
  it('debit and prepaid are never surcharged', () => {
    expect(splitCardSurchargeCents(10000, true, 3, 'debit')).toBe(0);
    expect(splitCardSurchargeCents(10000, true, 3, 'prepaid')).toBe(0);
  });
  it('known credit: estimate at the configured rate, hard-capped at 3%, rounded to the cent', () => {
    expect(splitCardSurchargeCents(10000, true, 3, 'credit')).toBe(300);
    expect(splitCardSurchargeCents(10000, true, 5, 'credit')).toBe(300);
    expect(splitCardSurchargeCents(10000, true, 2.5, 'credit')).toBe(250);
    expect(splitCardSurchargeCents(1650, true, 3, 'credit')).toBe(50);
  });
  it('0 when disabled, zero percent, or no card dollars', () => {
    expect(splitCardSurchargeCents(10000, false, 3, 'credit')).toBe(0);
    expect(splitCardSurchargeCents(10000, true, 0, 'credit')).toBe(0);
    expect(splitCardSurchargeCents(0, true, 3, 'credit')).toBe(0);
  });
  it('surcharge is OFF by default (per-MID Fiserv enrollment required)', () => {
    expect(DEFAULT_CHECKOUT_SETTINGS.creditCardSurchargeEnabled).toBe(false);
  });
  it('computeTotals never adds a local card fee — card and cash totals are equal', () => {
    const on = { ...DEFAULT_CHECKOUT_SETTINGS, creditCardSurchargeEnabled: true };
    const card = computeTotals(10000, 1000, on, 'card'); const cash = computeTotals(10000, 1000, on, 'cash');
    expect(card.surchargeCents).toBe(0);
    expect(card.totalDueCents).toBe(cash.totalDueCents);
  });
});

describe('paySplit — provider-assessed card surcharge', () => {
  it('authorizes the card segment at its BASE amount only — never base + a local 3% (no double surcharge)', async () => {
    const repo = new ConnectedRepo(true); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const cash = 2000; const cardBase = due - cash;
    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);
    expect(calls.capture).toBe(1);
    expect(calls.lastAmount).toBe(cardBase);
    expect(res.cardSurchargeCents).toBe(0);
    expect(res.payments.find((p: any) => p.method === 'card').amountCents).toBe(cardBase);
    expect(res.payments.find((p: any) => p.method === 'cash').amountCents).toBe(cash);
  });

  it('records the provider-assessed fee exactly once on the card segment; cash untouched', async () => {
    const repo = new ConnectedRepo(true); const { processor, calls } = makeProcessor({ fee: 270 });
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const cash = 2000; const cardBase = due - cash;
    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);
    expect(calls.lastAmount).toBe(cardBase);                      // asked for the base
    expect(res.cardSurchargeCents).toBe(270);                     // provider's figure, not 3% of anything we computed
    const cardRow = res.payments.find((p: any) => p.method === 'card');
    expect(cardRow.amountCents).toBe(cardBase + 270);
    expect(cardRow.surchargeCents).toBe(270);
    expect(res.payments.find((p: any) => p.method === 'cash').surchargeCents ?? 0).toBe(0);
  });

  it('a waived surcharge (debit/prepaid/restricted ZIP) records 0', async () => {
    const repo = new ConnectedRepo(true); const { processor } = makeProcessor({ fee: 0, feeType: 'SURCHRG_WAIVED' });
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const cash = 2000;
    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: due - cash }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);
    expect(res.cardSurchargeCents).toBe(0);
  });

  it('a contradictory approved amount is NOT recorded as paid (held for reconciliation)', async () => {
    const repo = new ConnectedRepo(true); const { processor } = makeProcessor({ approvedOverride: 1 });
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const cash = 2000;
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: due - cash }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any)).rejects.toThrow(/different amount/);
    expect(await repo.paidTotalCents(ctx, 'tk_2043')).toBe(0);
  });

  it('passes an idempotency key on the split card capture so the processor can dedupe a retry', async () => {
    const repo = new ConnectedRepo(true); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const cash = 2000;
    await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: due - cash }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any);
    expect((calls.lastIdempotencyKey || '').length).toBeGreaterThan(0);
  });

  it('a concurrent split with the same card charge does NOT double-capture (claim-first via payment_attempts)', async () => {
    const repo = new ConnectedRepo(true); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const cash = 2000; const cardBase = due - cash;
    const claim = await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: cardBase, idempotencyKey: buildIdempotencyKey('tk_2043', 'card', cardBase) });
    expect(claim.claimed).toBe(true);
    // A concurrent split with the same card charge must refuse without touching the gateway. Since B-81 (Oct 23 2026)
    // the in-flight reservation is seen by the unsettled-tender guard first (PAYMENT_STATUS_UNKNOWN, "do not run another
    // tender"); the claim's own "already being processed" remains the second line.
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: cardBase }, { method: 'cash', amountCents: cash }], cardToken: 'tok' } as any)).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN|already being processed/i);
    expect(calls.capture).toBe(0);
  });

  it('claimPaymentAttempt: a second claim with the same key fails in flight; release frees it', async () => {
    const repo = new ConnectedRepo(true);
    expect((await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: 5000, idempotencyKey: 'ATT-1' })).claimed).toBe(true);
    expect((await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: 5000, idempotencyKey: 'ATT-1' })).claimed).toBe(false);
    await repo.releasePaymentAttempt(ctx, 'ATT-1');
    expect((await repo.claimPaymentAttempt(ctx, { ticketId: 'tk_2043', method: 'card', amountCents: 5000, idempotencyKey: 'ATT-1' })).claimed).toBe(true);
  });

  it('rejects a split with two card segments (and never charges the processor)', async () => {
    const repo = new ConnectedRepo(true); const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents; const half = Math.floor(due / 2);
    await expect(svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'card', amountCents: half }, { method: 'card', amountCents: due - half }], cardToken: 'tok' } as any)).rejects.toThrow(/at most one card segment/i);
    expect(calls.capture).toBe(0);
  });

  it('owes no surcharge for a fully cash split (no card dollars)', async () => {
    const repo = new ConnectedRepo(true); const { processor } = makeProcessor({ fee: 999 });
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const due = (await repo.totalsFor(ctx, 'tk_2043', 'split'))!.totalDueCents;
    const res: any = await svc.paySplit(ctx, 'tk_2043', { segments: [{ method: 'cash', amountCents: due }] } as any);
    expect(res.cardSurchargeCents).toBe(0);
  });
});

describe('checkout KPIs — surcharge collected = provider-assessed fees only', () => {
  it('a straight card payment with a provider fee reports that fee; tax is reported too', async () => {
    const repo = new ConnectedRepo(true); const { processor } = makeProcessor({ fee: 300 });
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const cardTotals = (await repo.totalsFor(ctx, 'tk_2043', 'card'))!;
    await svc.payCard(ctx, 'tk_2043', { cardToken: 'tok' } as any);
    const kpis = await svc.getKpis(ctx);
    expect(kpis.cardSurchargeCollectedCents).toBe(300);
    expect(kpis.taxCollectedCents).toBe(cardTotals.taxCents);
  });
  it('a card payment with no provider fee reports 0 surcharge (no local 3%)', async () => {
    const repo = new ConnectedRepo(true); const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    await svc.payCard(ctx, 'tk_2043', { cardToken: 'tok' } as any);
    expect((await svc.getKpis(ctx)).cardSurchargeCollectedCents).toBe(0);
  });
  it('reports 0 surcharge collected for a fully cash payment', async () => {
    const repo = new ConnectedRepo(true); const { processor } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const cashTotals = (await repo.totalsFor(ctx, 'tk_2043', 'cash'))!;
    await svc.payCash(ctx, 'tk_2043', { amountReceivedCents: cashTotals.totalDueCents } as any);
    const kpis = await svc.getKpis(ctx);
    expect(kpis.cardSurchargeCollectedCents).toBe(0);
    expect(kpis.taxCollectedCents).toBe(cashTotals.taxCents);
  });
});
