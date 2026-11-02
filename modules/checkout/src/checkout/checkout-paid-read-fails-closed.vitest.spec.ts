// checkout-paid-read-fails-closed.vitest.spec — Checkout One-Screen + Payment Safety mandate §37 / §49 (Oct 28 2026).
// "What is already paid" decides how much every tender takes. When that read fails, NO tender may run: the Kysely
// repository used to answer 0 on a read error, so a ticket with $50 already paid of $100 was charged $100 again.
// Here the repository's paid read rejects; every tender must refuse before reaching the processor or recording money.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

function spyProcessor() {
  const calls = { capture: 0 };
  return { calls, processor: { name: 'spy', async authorizeAndCapture() { calls.capture++; return { approved: true, retref: 'R', authCode: 'A', respstat: 'A' }; }, async voidTransaction() { return { approved: true }; }, async refund() { return { approved: true }; } } as any };
}
class BrokenPaidReadRepo extends InMemoryCheckoutRepository {
  failPaidRead = true;
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected' } as any; }
  async paidTotalCents(ctx: CheckoutContext, ticketId: string) { if (this.failPaidRead) throw new Error('db connection reset'); return super.paidTotalCents(ctx, ticketId); }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment'] };
const TK = 'tk_2042';

describe('a failed "already paid" read stops every tender (fail closed)', () => {
  it('card: refuses, the processor is never asked, nothing is recorded', async () => {
    const repo = new BrokenPaidReadRepo(); const { processor, calls } = spyProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const before = (await repo.paymentsForTicket(ctx, TK)).length;
    await expect(svc.payCard(ctx, TK, { cardToken: 'tok' } as any)).rejects.toThrow(/connection reset/);
    expect(calls.capture).toBe(0);
    expect((await repo.paymentsForTicket(ctx, TK)).length).toBe(before);
  });
  it('cash: refuses and records nothing', async () => {
    const repo = new BrokenPaidReadRepo(); const svc = new CheckoutService(repo);
    const before = (await repo.paymentsForTicket(ctx, TK)).length;
    await expect(svc.payCash(ctx, TK, { amountReceivedCents: 100_00 } as any)).rejects.toThrow(/connection reset/);
    expect((await repo.paymentsForTicket(ctx, TK)).length).toBe(before);
  });
  it('split: refuses, the processor is never asked, nothing is recorded', async () => {
    const repo = new BrokenPaidReadRepo(); const { processor, calls } = spyProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const before = (await repo.paymentsForTicket(ctx, TK)).length;
    await expect(svc.paySplit(ctx, TK, { segments: [{ method: 'cash', amountCents: 1000 }, { method: 'card', amountCents: 1000 }] } as any)).rejects.toThrow();
    expect(calls.capture).toBe(0);
    expect((await repo.paymentsForTicket(ctx, TK)).length).toBe(before);
  });
  it('control: with the read working, the same card payment goes through once', async () => {
    const repo = new BrokenPaidReadRepo(); repo.failPaidRead = false; const { processor, calls } = spyProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, processor);
    const r: any = await svc.payCard(ctx, TK, { cardToken: 'tok' } as any);
    expect(r.status).toBe('approved'); expect(calls.capture).toBe(1);
  });
});

describe('the Kysely repository no longer swallows the read error (source check)', () => {
  it('paidTotalCents has no catch that turns an error into 0', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./checkout.kysely.repository.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('async paidTotalCents('), src.indexOf('async setFinalTotals('));
    expect(body).not.toMatch(/\.catch\(/);
  });
});
