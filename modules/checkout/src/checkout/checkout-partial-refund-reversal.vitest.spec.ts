// checkout-partial-refund-reversal.vitest.spec.ts — partial refunds now carry line attribution (Jul 29, 2026).
// Closes the recorded helper-allocation deferred item: "only FULL refunds auto-reverse today". Pinned here:
//  - a partial refund WITH serviceLineIds fires a 'partial' reversal naming exactly those lines (deduped),
//    tip reversal following the caller's explicit flag — the engine reverses each named line WHOLE;
//  - a partial refund WITHOUT lines still reverses nothing (unchanged, documented behavior);
//  - a FULL refund still fires the unchanged full/tipRefunded:true event even if lines were (redundantly) sent;
//  - a line id that does not belong to the ticket fails the REQUEST before any money moves.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.refund'] };
const TK = 'tk_2042';

async function paidHarness(prepare?: (repo: InMemoryCheckoutRepository) => Promise<number>) {
  const repo = new InMemoryCheckoutRepository();
  const CAPTURED = prepare ? await prepare(repo) : 5000;
  const events: any[] = [];
  const compensation = {
    snapshotPaidTicket: async () => ({ ok: true }),
    reverseForRefund: async (_c: any, ticketId: string, event: any, opts: any) => { events.push({ ticketId, event, opts }); return { ok: true, entries: 1 }; },
  };
  const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, compensation);
  // Seed the captured payment the way the refund-atomic spec does — refund() only needs findPayment + ticket lines.
  await repo.recordPayment(ctx, { paymentId: 'pay_pr1', ticketId: TK, method: 'cash', amountCents: CAPTURED, tipCents: 0, status: 'approved', createdAt: new Date().toISOString() } as any);
  const lineIds = (await repo.ticket(ctx, TK))!.lines.map((l) => l.serviceLineId);
  return { svc, repo, events, paymentId: 'pay_pr1', due: CAPTURED, lineIds };
}

describe('partial refund → line-granular commission reversal', () => {
  it("partial WITH lines fires a 'partial' event naming exactly the deduped lines, tip per the flag", async () => {
    const { svc, events, paymentId, lineIds } = await paidHarness();
    const target = lineIds[0];
    await svc.refund(ctx, paymentId, { reason: 'redo on one service', amountCents: 500, serviceLineIds: [target, target], tipRefunded: true });
    const rev = events.filter((e) => e.event.type !== undefined && e.event.type !== 'snapshot');
    expect(rev.length).toBe(1);
    expect(rev[0].event.type).toBe('partial');
    expect(rev[0].event.lines).toEqual([{ serviceLineId: target, refundTip: true }]);   // deduped, flag carried
    expect(rev[0].opts.reason).toBe('redo on one service');
  });

  // RE-PINNED (merge Oct 12 2026 — other chat's technician audit; Payroll mandate §52): "partial without lines reverses
  // nothing" WAS the bug (a $5 goodwill refund left the technician credited for the full ticket). It reverses PRO-RATA.
  it('partial WITHOUT lines reverses PRO-RATA (refunded/captured) across every line', async () => {
    const { svc, events, paymentId, due } = await paidHarness();
    await svc.refund(ctx, paymentId, { reason: 'goodwill', amountCents: 500 });
    expect(events.length).toBe(1);
    expect(events[0].event.type).toBe('partial');
    expect(events[0].event.lines).toBeUndefined();
    expect(events[0].event.refundedCents).toBe(500);
    expect(events[0].event.capturedCents).toBe(due);
  });

  // Oct 13 2026 (live money-chain proof): the reversal is measured against the COMMISSIONABLE money — the ticket's
  // tip, tax and surcharge are not commission basis, so the checkout tells the ledger how much of the captured amount
  // they are (captured − subtotal). A $45 refund of a $45 service paid as $60.24 then reverses the whole commission.
  it('partial WITHOUT lines carries the non-commissionable part of the capture (tip + tax) so the ledger pro-rates on the service money', async () => {
    // the customer paid the whole ticket INCLUDING a $10.00 tip (+ tax); the capture is the total due
    const { svc, repo, events, paymentId, due } = await paidHarness(async (r) => {
      await r.setTip(ctx, TK, 1000, { tipType: 'custom', tipPercent: null });
      return (await r.totalsFor(ctx, TK))!.totalDueCents;
    });
    const tot = (await repo.totalsFor(ctx, TK))!;
    expect(tot.tipCents).toBe(1000);
    await svc.refund(ctx, paymentId, { reason: 'service refund', amountCents: 500 });
    expect(events[0].event.type).toBe('partial');
    expect(events[0].event.capturedCents).toBe(due);
    expect(events[0].event.nonCommissionableCents).toBe(due - tot.subtotalCents);
    expect(events[0].event.nonCommissionableCents).toBeGreaterThanOrEqual(1000);
  });

  it('FULL refund still fires the unchanged full event even when lines are redundantly sent', async () => {
    const { svc, events, paymentId, due, lineIds } = await paidHarness();
    await svc.refund(ctx, paymentId, { reason: 'full refund', amountCents: due, serviceLineIds: [lineIds[0]] });
    expect(events.length).toBe(1);
    // refundPaymentId is the ledger idempotency key (588); the in-memory repo mints non-UUID ids so it is null here (real rows carry it)
    expect(events[0].event).toEqual({ type: 'full', tipRefunded: true, refundPaymentId: null });
  });

  it('a line id not on this ticket fails the REQUEST before any money moves', async () => {
    const { svc, repo, events, paymentId } = await paidHarness();
    const before = await repo.findPayment(ctx, paymentId);
    await expect(svc.refund(ctx, paymentId, { reason: 'typo', amountCents: 500, serviceLineIds: ['sl_not_real'] }))
      .rejects.toThrow(/must belong to this ticket: sl_not_real/);
    const after = await repo.findPayment(ctx, paymentId);
    expect(after!.status).toBe(before!.status);   // no refund happened
    expect(events.length).toBe(0);                // and no reversal fired
  });

  it('default tip stance on a partial is refundTip:false (tip stays unless the caller says otherwise)', async () => {
    const { svc, events, paymentId, lineIds } = await paidHarness();
    await svc.refund(ctx, paymentId, { reason: 'service redo', amountCents: 300, serviceLineIds: [lineIds[1] ?? lineIds[0]] });
    expect(events[0].event.lines[0].refundTip).toBe(false);
  });
});
