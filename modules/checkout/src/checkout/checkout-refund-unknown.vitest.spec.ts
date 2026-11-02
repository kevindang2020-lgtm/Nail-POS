// checkout-refund-unknown.vitest.spec.ts — mandate P0 §228 / §223 (Oct 20 2026): NO DUPLICATE REFUND ON RETRY.
//
// Before: when processor.refund() threw (timeout, network, 5xx) the reservation was released and the error re-thrown; the
// route's @Idempotent key is dropped on failure too. A retry therefore reached CardPointe a second time, and a refund the
// processor had already made was made again. A 'B' (retry) answer was treated as a decline the same way.
//
// Now: anything but an approval or a DEFINITE decline keeps the amount reserved in 'processing' (unknown), answers
// REFUND_STATUS_UNKNOWN, refuses every further refund on that payment (REFUND_PENDING_VERIFICATION), and only the
// processor's own record — through settleUnknownRefund — turns it into a refund or releases it.
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, ValidationError, isDefiniteRefundDecline } from './checkout.service';
import { decideRefundAttempt, UNREACHABLE_REVIEW_FACTOR, PaymentAttemptSweep, type PaymentAttemptSweepStore, type PaymentAttemptSweepProcessor, type StrandedRefund } from './payment-attempt-sweep';

class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(ctx: CheckoutContext) { return { ...(await super.settings(ctx)), fiservStatus: 'connected' } as any; }
}
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.refund', 'pos.checkout.approve_refund'] };

function processor(refundImpl: () => Promise<any>) {
  const p: any = {
    name: 'spy', refunds: 0,
    async authorizeAndCapture() { return { approved: true, retref: 'RET-ORIG', authCode: 'A1', respstat: 'A', respText: 'Approved' }; },
    async voidTransaction(input: any) { return { approved: true, retref: input.retref }; },
    async refund() { p.refunds++; return refundImpl(); },
  };
  return p;
}
async function paidTicket(repo: ConnectedRepo, proc: any) {
  const svc = new CheckoutService(repo, undefined, undefined, proc);
  const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'PAY-1' } as any);
  expect(r.status).toBe('approved');
  return { svc, paymentId: r.paymentId as string };
}
const timeout = () => { const e: any = new Error('ETIMEDOUT: the processor did not answer'); e.code = 'ETIMEDOUT'; return Promise.reject(e); };

describe('a refund whose processor answer was lost', () => {
  let repo: ConnectedRepo;
  beforeEach(() => { repo = new ConnectedRepo(); });

  it('timeout: the amount stays reserved as "processing", the cashier gets REFUND_STATUS_UNKNOWN, and a retry does NOT reach the processor again', async () => {
    const proc = processor(timeout);
    const { svc, paymentId } = await paidTicket(repo, proc);
    await expect(svc.refund(ctx, paymentId, { reason: 'wrong tip', amountCents: 1500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    expect(proc.refunds).toBe(1);
    expect(repo.refundRows.filter((r) => r.status === 'processing')).toHaveLength(1);        // kept, not released
    expect(await repo.refundedTotalCents(ctx, paymentId)).toBe(1500);                          // still counts toward the cap
    // the cashier (or the @Idempotent retry after a dropped key) tries again — refused BEFORE the gateway
    await expect(svc.refund(ctx, paymentId, { reason: 'wrong tip', amountCents: 1500 })).rejects.toMatchObject({ message: 'REFUND_PENDING_VERIFICATION' });
    await expect(svc.refund(ctx, paymentId, { reason: 'something else', amountCents: 500 })).rejects.toMatchObject({ message: 'REFUND_PENDING_VERIFICATION' });
    expect(proc.refunds).toBe(1);                                                                // before: 2 (double refund)
    expect((await repo.paymentsForTicket(ctx, 'tk_2042')).filter((p) => p.status === 'refunded')).toHaveLength(0);   // nothing recorded as refunded yet
  });

  it("a 'B' (retry) answer from CardPointe is NOT a decline: same unknown handling, nothing released", async () => {
    const proc = processor(async () => ({ ok: false, respstat: 'B', respText: 'Retry' }));
    const { svc, paymentId } = await paidTicket(repo, proc);
    await expect(svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1000 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    expect(repo.refundRows.filter((r) => r.status === 'processing')).toHaveLength(1);
    await expect(svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1000 })).rejects.toMatchObject({ message: 'REFUND_PENDING_VERIFICATION' });
    expect(proc.refunds).toBe(1);
  });

  it("a DEFINITE decline ('C') still releases the reservation and tells the cashier; a later refund may try again", async () => {
    const proc = processor(async () => ({ ok: false, respstat: 'C', respText: 'Refund declined' }));
    const { svc, paymentId } = await paidTicket(repo, proc);
    await expect(svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1000 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1000 })).rejects.toThrow(/declined by the processor/);
    expect(repo.refundRows).toHaveLength(0);
    expect(await repo.refundedTotalCents(ctx, paymentId)).toBe(0);
    expect(proc.refunds).toBe(2);
  });

  it('§68 (found by pilot phase 14): a refund the SWEEP settles reverses commission with requested_by NULL — the system actor id never reaches the uuid column', async () => {
    const proc = processor(timeout);
    const calls: any[] = [];
    const comp: any = { async reverseForRefund(_c: any, _t: string, _e: any, opts: any) { calls.push(opts); return { ok: true }; } };
    const svc = new CheckoutService(repo, undefined, undefined, proc, undefined, undefined, comp);
    const r: any = await svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', idempotencyKey: 'PAY-S' } as any);
    await expect(svc.refund(ctx, r.paymentId, { reason: 'lost answer', amountCents: 1500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    const refundId = repo.refundRows.find((x) => x.status === 'processing')!.id;
    expect(await svc.settleUnknownRefundFromSweep(ctx.tenantId, ctx.branchId as string, refundId, { kind: 'refunded', processorRefundId: 'RET-RFND-S' }, 'sweep')).toMatchObject({ settled: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ requestedBy: null });
  });

  it('settle "refunded" (from the processor record): the refund payment row, the finalized reservation with the real retref, and the side effects — once', async () => {
    const proc = processor(timeout);
    const { svc, paymentId } = await paidTicket(repo, proc);
    await expect(svc.refund(ctx, paymentId, { reason: 'wrong tip', amountCents: 1500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    const refundId = repo.refundRows.find((r) => r.status === 'processing')!.id;
    const s1 = await svc.settleUnknownRefund(ctx, refundId, { kind: 'refunded', processorRefundId: 'RET-RFND-9' }, 'sweep', 'processor shows RET-RFND-9');
    expect(s1).toEqual({ settled: true, status: 'refunded' });
    const refunded = (await repo.paymentsForTicket(ctx, 'tk_2042')).filter((p) => p.status === 'refunded');
    expect(refunded).toHaveLength(1);
    expect(refunded[0].amountCents).toBe(1500);
    expect(refunded[0].processorTransactionId).toBe('RET-RFND-9');
    expect(repo.refundRows.find((r) => r.id === refundId)).toMatchObject({ status: 'refunded', processorRefundId: 'RET-RFND-9' });
    expect(proc.refunds).toBe(1);                                                                // settling never sends a refund
    // settling twice is a no-op (conditional on 'processing')
    expect(await svc.settleUnknownRefund(ctx, refundId, { kind: 'refunded', processorRefundId: 'RET-RFND-9' }, 'sweep')).toEqual({ settled: false, status: 'not_processing' });
    expect((await repo.paymentsForTicket(ctx, 'tk_2042')).filter((p) => p.status === 'refunded')).toHaveLength(1);
    // the payment is refundable again for the remainder, through the normal path
    proc.refund = async () => { proc.refunds++; return { ok: true, respstat: 'A', retref: 'RET-RFND-10' }; };
    const r2: any = await svc.refund(ctx, paymentId, { reason: 'rest', amountCents: 500 });
    expect(r2.status).toBe('refunded');
  });

  it('settle "not_refunded" (the processor holds no such refund): the hold is released and the cashier may refund again', async () => {
    const proc = processor(timeout);
    const { svc, paymentId } = await paidTicket(repo, proc);
    await expect(svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    const refundId = repo.refundRows.find((r) => r.status === 'processing')!.id;
    expect(await svc.settleUnknownRefund(ctx, refundId, { kind: 'not_refunded' }, 'sweep')).toEqual({ settled: true, status: 'released' });
    expect(repo.refundRows).toHaveLength(0);
    expect(await repo.refundedTotalCents(ctx, paymentId)).toBe(0);
    proc.refund = async () => { proc.refunds++; return { ok: true, respstat: 'A', retref: 'RET-RFND-2' }; };
    const r: any = await svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1500 });
    expect(r.status).toBe('refunded');
    expect(proc.refunds).toBe(2);
  });

  it('manual settle needs the refund permission, the ticket to match, and a note', async () => {
    const proc = processor(timeout);
    const { svc, paymentId } = await paidTicket(repo, proc);
    await expect(svc.refund(ctx, paymentId, { reason: 'x', amountCents: 1500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    const refundId = repo.refundRows.find((r) => r.status === 'processing')!.id;
    const desk = { ...ctx, role: 'RECEPTIONIST', permissions: ['pos.checkout.view'] };
    await expect(svc.settleUnknownRefundManually(desk, 'tk_2042', refundId, { outcome: 'refunded', note: 'portal shows it' })).rejects.toThrow(/Missing pos.checkout.refund/);
    await expect(svc.settleUnknownRefundManually(ctx, 'tk_2042', refundId, { outcome: 'refunded', note: '' })).rejects.toThrow(/needs a note/);
    await expect(svc.settleUnknownRefundManually(ctx, 'tk_other', refundId, { outcome: 'refunded', note: 'portal shows it' })).rejects.toThrow(/does not belong/);
    expect(await svc.settleUnknownRefundManually(ctx, 'tk_2042', refundId, { outcome: 'refunded', processorRefundId: 'RET-M-1', note: 'CardPointe portal: refund RET-M-1 approved 10:42' })).toEqual({ settled: true, status: 'refunded' });
    await expect(svc.settleUnknownRefundManually(ctx, 'tk_2042', refundId, { outcome: 'refunded', note: 'again' })).rejects.toThrow(/not waiting for verification/);
  });
});

describe('isDefiniteRefundDecline', () => {
  it("only an explicit decline frees the money: 'C' or declined:true; 'B', '', undefined and anything else are unknown", () => {
    expect(isDefiniteRefundDecline({ ok: false, respstat: 'C' })).toBe(true);
    expect(isDefiniteRefundDecline({ ok: false, declined: true })).toBe(true);
    expect(isDefiniteRefundDecline({ ok: false, respstat: 'B' })).toBe(false);
    expect(isDefiniteRefundDecline({ ok: false, respstat: '' })).toBe(false);
    expect(isDefiniteRefundDecline({ ok: false })).toBe(false);
    expect(isDefiniteRefundDecline({ ok: false, respstat: 'X' })).toBe(false);
  });
});

describe('decideRefundAttempt (pure) — the processor record decides, never a guess', () => {
  const STRANDED = 15 * 60_000;
  const old = STRANDED + 1;
  const orig = { retref: 'RET-ORIG', approved: true, declined: false, amountCents: 10_000 };
  const answer = (...txns: any[]) => ({ kind: 'answer' as const, processor: 'cardpointe', transactions: txns });
  const none = new Set<string>();

  it('one approved non-original transaction of the exact amount → the refund happened → settle with that retref', () => {
    const d = decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, answer(orig, { retref: 'RET-R1', approved: true, declined: false, amountCents: 1500 }), none, STRANDED);
    expect(d).toMatchObject({ action: 'refunded', retref: 'RET-R1' });
  });
  it('the original charge and no refund of that amount, past the stranded window → the refund never happened → release', () => {
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, answer(orig), none, STRANDED)).toMatchObject({ action: 'release' });
  });
  it('… but inside the stranded window the host may still be working on it → wait', () => {
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: 1000 }, answer(orig), none, STRANDED)).toMatchObject({ action: 'wait' });
  });
  it('an already-recorded refund retref of the same amount is NOT this one; with nothing else → release (old) / wait (young)', () => {
    const prior = { retref: 'RET-PRIOR', approved: true, declined: false, amountCents: 1500 };
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, answer(orig, prior), new Set(['RET-PRIOR']), STRANDED)).toMatchObject({ action: 'release' });
  });
  it('a different amount is not a match', () => {
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, answer(orig, { retref: 'RET-R1', approved: true, declined: false, amountCents: 1400 }), none, STRANDED)).toMatchObject({ action: 'release' });
  });
  it('two candidates → a person matches them (review, never money)', () => {
    const d = decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, answer(orig, { retref: 'RET-R1', approved: true, declined: false, amountCents: 1500 }, { retref: 'RET-R2', approved: true, declined: false, amountCents: 1500 }), none, STRANDED);
    expect(d).toMatchObject({ action: 'review' });
  });
  it('an answer that does not even show the original charge cannot prove a negative → review, never release', () => {
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, answer(), none, STRANDED)).toMatchObject({ action: 'review' });
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: null, ageMs: old }, answer(orig), none, STRANDED)).toMatchObject({ action: 'review' });
  });
  it('unreachable → wait, then review after the unreachable window; not connected / no inquiry → review at once', () => {
    const un = { kind: 'unreachable' as const, processor: 'cardpointe', error: 'ECONNRESET' };
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, un, none, STRANDED)).toMatchObject({ action: 'wait' });
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: STRANDED * UNREACHABLE_REVIEW_FACTOR + 1 }, un, none, STRANDED)).toMatchObject({ action: 'review' });
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, { kind: 'not_connected' }, none, STRANDED)).toMatchObject({ action: 'review' });
    expect(decideRefundAttempt({ amountCents: 1500, originalRetref: 'RET-ORIG', ageMs: old }, { kind: 'no_inquiry', processor: 'clover' }, none, STRANDED)).toMatchObject({ action: 'review' });
  });
});

describe('PaymentAttemptSweep — the refund population', () => {
  const f: StrandedRefund = { refundId: 'rf1', tenantId: 't1', branchId: 'b1', ticketId: 'tk1', paymentId: 'p1', amountCents: 1500, originalRetref: 'RET-ORIG', createdAt: new Date(Date.now() - 60 * 60_000).toISOString(), strandedAt: null, reviewReason: null };
  function store(refunds: StrandedRefund[]) {
    const alerts: any[] = []; const reviews: any[] = [];
    const s: PaymentAttemptSweepStore = {
      strandedSplitAttempts: async () => [], strandedCardPayments: async () => [], recordedRetrefs: async () => new Set(),
      resolveSplitAttempt: async () => true, markCardPaymentStranded: async () => true, raiseAlert: async (a) => { alerts.push(a); },
      strandedRefunds: async () => refunds, recordedRefundRetrefs: async () => new Set(), markRefundForReview: async (r, reason) => { reviews.push([r.refundId, reason]); return true; },
    };
    return { s, alerts, reviews };
  }
  function proc(answer: any) {
    const settled: any[] = [];
    const p: PaymentAttemptSweepProcessor = { inquire: async () => answer, reconcileCard: async () => 'none', settleRefund: async (t, b, id, outcome) => { settled.push([id, outcome]); return { settled: true }; } };
    return { p, settled };
  }
  it('settles a found refund through settleRefund with the processor retref — never sends a refund', async () => {
    const { s } = store([f]); const { p, settled } = proc({ kind: 'answer', processor: 'cardpointe', transactions: [{ retref: 'RET-ORIG', approved: true, declined: false, amountCents: 10_000 }, { retref: 'RET-R1', approved: true, declined: false, amountCents: 1500 }] });
    const r = await new PaymentAttemptSweep(s, p).run();
    expect(r.refundsSettled).toBe(1); expect(settled).toEqual([['rf1', { kind: 'refunded', processorRefundId: 'RET-R1' }]]);
  });
  it('releases a refund the processor never made — once the processor\'s refund listing is confirmed (PAYMENTS_REFUND_INQUIRY_VERIFIED)', async () => {
    const { s } = store([f]); const { p, settled } = proc({ kind: 'answer', processor: 'cardpointe', transactions: [{ retref: 'RET-ORIG', approved: true, declined: false, amountCents: 10_000 }] });
    const r = await new PaymentAttemptSweep(s, p, { refundReleaseTrusted: true }).run();
    expect(r.refundsReleased).toBe(1); expect(settled).toEqual([['rf1', { kind: 'not_refunded' }]]);
  });
  it('Oct 28 audit (§33): until that listing is confirmed, "no refund under the original order" goes to a PERSON — never an automatic release (a second refund could follow)', async () => {
    const prev = process.env.PAYMENTS_REFUND_INQUIRY_VERIFIED; delete process.env.PAYMENTS_REFUND_INQUIRY_VERIFIED;
    try {
      const { s, alerts, reviews } = store([f]); const { p, settled } = proc({ kind: 'answer', processor: 'cardpointe', transactions: [{ retref: 'RET-ORIG', approved: true, declined: false, amountCents: 10_000 }] });
      const r = await new PaymentAttemptSweep(s, p).run();
      expect(r.refundsReleased).toBe(0); expect(settled).toEqual([]);
      expect(r.refundsNeedReview).toBe(1); expect(alerts).toHaveLength(1);
      expect(reviews[0][1]).toMatch(/not released automatically/);
    } finally { if (prev !== undefined) process.env.PAYMENTS_REFUND_INQUIRY_VERIFIED = prev; }
  });
  it('hands an undecidable one to a person once: review + ONE alert; a later run asks nothing more', async () => {
    const { s, alerts, reviews } = store([f]); const { p, settled } = proc({ kind: 'not_connected' });
    const r = await new PaymentAttemptSweep(s, p).run();
    expect(r.refundsNeedReview).toBe(1); expect(alerts).toHaveLength(1); expect(alerts[0]).toMatchObject({ kind: 'refund', id: 'rf1', resolution: 'needs_review' }); expect(reviews).toHaveLength(1); expect(settled).toHaveLength(0);
    const { s: s2, alerts: a2 } = store([{ ...f, reviewReason: 'with a person' }]);
    const r2 = await new PaymentAttemptSweep(s2, p).run();
    expect(r2.refundsNeedReview).toBe(1); expect(a2).toHaveLength(0);
  });
  it('Oct 28 2026: a TAP TO PAY refund (CommerceHub rail) is never decided from the card gateway — it goes to a person, even when the listing is trusted', async () => {
    const { s, alerts, reviews } = store([{ ...f, surface: 'tap_to_pay_iphone' }]);
    let asked = 0;
    const { p, settled } = proc({ kind: 'answer', processor: 'cardpointe', transactions: [] });
    const inquire = p.inquire; p.inquire = async (...a: any[]) => { asked++; return (inquire as any)(...a); };
    const r = await new PaymentAttemptSweep(s, p, { refundReleaseTrusted: true }).run();
    expect(asked).toBe(0); expect(settled).toEqual([]); expect(r.refundsReleased).toBe(0);
    expect(r.refundsNeedReview).toBe(1); expect(alerts).toHaveLength(1); expect(reviews[0][1]).toMatch(/Tap to Pay/);
  });
});
