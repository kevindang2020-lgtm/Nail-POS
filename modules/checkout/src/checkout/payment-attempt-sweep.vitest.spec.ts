// payment-attempt-sweep.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §116): stranded card attempts are resolved
// ONLY from the processor's own answer; anything else becomes needs_review + an alert. Never a charge, void or refund.
import { describe, it, expect, afterEach } from 'vitest';
import {
  PaymentAttemptSweep, decideSplitAttempt, strandedMinutes, UNREACHABLE_REVIEW_FACTOR,
  type PaymentAttemptSweepStore, type StrandedSplitAttempt, type StrandedCardPayment, type SweepAlert, type ProcessorAnswer,
} from './payment-attempt-sweep';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService, SWEEP_ACTOR } from './checkout.service';

const MIN = 60_000;
const T15 = 15 * MIN;
const answer = (...transactions: any[]): ProcessorAnswer => ({ kind: 'answer', processor: 'cardpointe', transactions });

describe('decideSplitAttempt — only the processor\'s answer moves money state', () => {
  const a = { amountCents: 4200, ageMs: 20 * MIN };
  it('approved + recorded → settle; approved + unrecorded → review (never auto-void)', () => {
    expect(decideSplitAttempt(a, answer({ retref: 'R1', approved: true, declined: false, amountCents: 4200 }), new Set(['R1']), T15)).toMatchObject({ action: 'settle', resolution: 'provider_approved_recorded' });
    expect(decideSplitAttempt(a, answer({ retref: 'R1', approved: true, declined: false, amountCents: 4200 }), new Set(), T15)).toMatchObject({ action: 'review', resolution: 'provider_approved_unrecorded', retref: 'R1' });
  });
  it('two unrecorded approvals → ambiguous review', () => {
    expect(decideSplitAttempt(a, answer({ retref: 'R1', approved: true, declined: false }, { retref: 'R2', approved: true, declined: false }), new Set(), T15)).toMatchObject({ action: 'review', resolution: 'provider_ambiguous' });
  });
  it('declined → release; no record → release (never reached the processor)', () => {
    expect(decideSplitAttempt(a, answer({ retref: 'D', approved: false, declined: true, amountCents: 4200 }), new Set(), T15)).toEqual({ action: 'release', resolution: 'provider_declined' });
    expect(decideSplitAttempt(a, answer(), new Set(), T15)).toEqual({ action: 'release', resolution: 'provider_not_found' });
  });
  it('only transactions of THIS amount count (another charge on the same ticket is ignored)', () => {
    expect(decideSplitAttempt(a, answer({ retref: 'OTHER', approved: true, declined: false, amountCents: 999 }), new Set(), T15)).toEqual({ action: 'release', resolution: 'provider_not_found' });
  });
  it('no inquiry API / not connected → review; unreachable → wait, then review after the factor', () => {
    expect(decideSplitAttempt(a, { kind: 'no_inquiry', processor: 'clover' }, new Set(), T15)).toMatchObject({ action: 'review', resolution: 'provider_no_inquiry' });
    expect(decideSplitAttempt(a, { kind: 'not_connected' }, new Set(), T15)).toMatchObject({ action: 'review', resolution: 'processor_not_connected' });
    expect(decideSplitAttempt(a, { kind: 'unreachable', processor: 'cardpointe', error: 'x' }, new Set(), T15).action).toBe('wait');
    expect(decideSplitAttempt({ ...a, ageMs: T15 * UNREACHABLE_REVIEW_FACTOR }, { kind: 'unreachable', processor: 'cardpointe', error: 'x' }, new Set(), T15)).toMatchObject({ action: 'review', resolution: 'provider_unreachable' });
  });
});

describe('strandedMinutes', () => {
  afterEach(() => { delete process.env.PAYMENT_ATTEMPT_STRANDED_MINUTES; });
  it('defaults to 15 and never goes below the five-minute not-found window', () => {
    expect(strandedMinutes({})).toBe(15);
    expect(strandedMinutes({ PAYMENT_ATTEMPT_STRANDED_MINUTES: '30' })).toBe(30);
    expect(strandedMinutes({ PAYMENT_ATTEMPT_STRANDED_MINUTES: '1' })).toBe(5);
    expect(strandedMinutes({ PAYMENT_ATTEMPT_STRANDED_MINUTES: 'junk' })).toBe(15);
  });
});

/** In-memory store with the same conditional semantics as the Kysely one. */
function memStore(splits: (StrandedSplitAttempt & { status: string; resolution?: string })[], cards: (StrandedCardPayment & { status: string })[], recorded: string[] = []) {
  const alerts: SweepAlert[] = [];
  const store: PaymentAttemptSweepStore = {
    async strandedSplitAttempts(cutoff) { return splits.filter((s) => s.status === 'processing' && Date.parse(s.createdAt) < cutoff.getTime()); },
    async strandedCardPayments(cutoff) { return cards.filter((c) => c.status === 'processing' && Date.parse(c.createdAt) < cutoff.getTime()); },
    async recordedRetrefs() { return new Set(recorded); },
    async resolveSplitAttempt(a, to) {
      const row = splits.find((s) => s.id === a.id)!;
      if (row.status !== 'processing') return false;
      row.status = to.status; row.resolution = to.resolution;
      if (to.releaseKey) row.idempotencyKey += '#released:' + row.id;
      return true;
    },
    async markCardPaymentStranded(p) { const row = cards.find((c) => c.paymentId === p.paymentId)!; if (row.strandedAt) return false; row.strandedAt = new Date().toISOString(); return true; },
    async raiseAlert(al) { alerts.push(al); },
    // mandate P0 §228: the refund population (covered in checkout-refund-unknown.vitest.spec.ts) — empty here
    async strandedRefunds() { return []; }, async recordedRefundRetrefs() { return new Set<string>(); }, async markRefundForReview() { return true; },
  };
  return { store, alerts };
}
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const split = (id: string, ageMs: number) => ({ id, tenantId: 't1', branchId: 'b1', ticketId: 'tk_' + id, amountCents: 4200, idempotencyKey: 'k_' + id, createdAt: ago(ageMs), status: 'processing' });

describe('PaymentAttemptSweep.run', () => {
  it('leaves fresh attempts alone; resolves stranded ones from the answer; review raises ONE alert; a second run is a no-op', async () => {
    const splits = [split('fresh', 2 * MIN), split('charged', 20 * MIN), split('declined', 20 * MIN), split('nothing', 20 * MIN)];
    const { store, alerts } = memStore(splits, []);
    const asked: string[] = [];
    const proc = {
      async inquire(_t: string, _b: string, order: string): Promise<ProcessorAnswer> {
        asked.push(order);
        if (order === 'tk_charged') return answer({ retref: 'R9', approved: true, declined: false, amountCents: 4200 });
        if (order === 'tk_declined') return answer({ retref: 'D9', approved: false, declined: true, amountCents: 4200 });
        return answer();
      },
      async reconcileCard() { return 'none' as const; },
      async settleRefund() { return { settled: true }; },
    };
    const sweep = new PaymentAttemptSweep(store, proc, { strandedMs: T15 });
    const r = await sweep.run();
    expect(asked.sort()).toEqual(['tk_charged', 'tk_declined', 'tk_nothing']);   // the 2-minute-old attempt is not touched
    expect(splits.map((s) => [s.id, s.status, s.resolution ?? null])).toEqual([
      ['fresh', 'processing', null],
      ['charged', 'needs_review', 'provider_approved_unrecorded'],
      ['declined', 'failed', 'provider_declined'],
      ['nothing', 'failed', 'provider_not_found'],
    ]);
    expect(splits.find((s) => s.id === 'charged')!.idempotencyKey).toBe('k_charged');               // keeps blocking a re-charge
    expect(splits.find((s) => s.id === 'declined')!.idempotencyKey).toBe('k_declined#released:declined');   // freed for a retry
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'split_attempt', id: 'charged', resolution: 'provider_approved_unrecorded', retref: 'R9' });
    expect(r).toMatchObject({ splitsChecked: 3, splitsNeedReview: 1, splitsReleased: 2, splitsSettled: 0 });
    const again = await sweep.run();
    expect(again.splitsChecked).toBe(0);
    expect(alerts).toHaveLength(1);
  });

  it('card payments: reconciled once per ticket; an unverifiable one is flagged ONCE and keeps being asked', async () => {
    const card = (id: string, ticket: string) => ({ paymentId: id, tenantId: 't1', branchId: 'b1', ticketId: ticket, amountCents: 5000, createdAt: ago(30 * MIN), strandedAt: null, status: 'processing' });
    const cards = [card('p1', 'tkA'), card('p2', 'tkA'), card('p3', 'tkB')];
    const { store, alerts } = memStore([], cards);
    const reconciled: string[] = [];
    const proc = { async inquire(): Promise<ProcessorAnswer> { return answer(); }, async reconcileCard(_t: string, _b: string, ticket: string) { reconciled.push(ticket); return ticket === 'tkA' ? 'unknown' as const : 'busy' as const; }, async settleRefund() { return { settled: true }; } };
    const sweep = new PaymentAttemptSweep(store, proc, { strandedMs: T15 });
    const r1 = await sweep.run();
    expect(reconciled).toEqual(['tkA', 'tkB']);
    expect(r1).toMatchObject({ cardsChecked: 2, cardsUnverified: 1, cardsBusy: 1 });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'card_payment', id: 'p1', resolution: 'unverified' });
    await sweep.run();
    expect(reconciled).toEqual(['tkA', 'tkB', 'tkA', 'tkB']);   // still asked every tick
    expect(alerts).toHaveLength(1);                               // but alerted once
  });

  it('one failing attempt does not stop the others', async () => {
    const splits = [split('boom', 20 * MIN), split('ok', 20 * MIN)];
    const { store } = memStore(splits, []);
    const proc = { async inquire(_t: string, _b: string, o: string): Promise<ProcessorAnswer> { if (o === 'tk_boom') throw new Error('db hiccup'); return answer(); }, async reconcileCard() { return 'none' as const; }, async settleRefund() { return { settled: true }; } };
    const r = await new PaymentAttemptSweep(store, proc, { strandedMs: T15 }).run();
    expect(r.errors).toBe(1);
    expect(splits.find((s) => s.id === 'ok')!.status).toBe('failed');
  });
});

// The CheckoutService entry points the scheduler uses — the existing Functional Decision 22 verification, as a system actor.
const owner: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] } as any;
const TK = 'tk_2042';
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(c: CheckoutContext) { return { ...(await super.settings(c)), fiservStatus: 'connected' } as any; }
}
function spyProcessor(inquiry: (() => any) | 'unreachable' | 'no-api') {
  const calls = { charge: 0, inquire: 0, void: 0, refund: 0 };
  const p: any = {
    name: 'spy',
    async authorizeAndCapture() { calls.charge++; throw new Error('ETIMEDOUT reading from terminal'); },
    async voidTransaction() { calls.void++; return { ok: true }; },
    async refund() { calls.refund++; return { ok: true }; },
  };
  if (inquiry !== 'no-api') p.inquireByOrderId = async () => { calls.inquire++; if (inquiry === 'unreachable') throw new Error('ECONNREFUSED'); return inquiry(); };
  return { p, calls };
}
const strand = async (svc: CheckoutService, repo: InMemoryCheckoutRepository) => {
  await expect(svc.payCard(owner, TK, { cardToken: 'tok' } as any)).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN/);
  const row = (repo as any).P(owner).find((x: any) => x.status === 'processing'); row.createdAt = new Date(Date.now() - 20 * MIN).toISOString(); return row;
};

describe('CheckoutService.reconcileStrandedCard / inquireProcessor', () => {
  it('a stranded card charge the processor APPROVED is completed by the sweep — no second charge, no void', async () => {
    const repo = new ConnectedRepo(); let amount = 0;
    const { p, calls } = spyProcessor(() => ({ transactions: [{ retref: 'RET-1', approved: true, declined: false, amountCents: amount }] }));
    const svc = new CheckoutService(repo, undefined, undefined, p);
    amount = (await strand(svc, repo)).amountCents;
    expect((await svc.reconcileStrandedCard(owner.tenantId, owner.branchId, TK)).status).toBe('approved');
    expect((await repo.ticket(owner, TK) as any).status).toBe('paid');
    expect(calls).toEqual({ charge: 1, inquire: 1, void: 0, refund: 0 });
    expect(svc.auditLog().some((e) => e.userId === SWEEP_ACTOR && e.actionType === 'pos_checkout_card_payment_verified_approved')).toBe(true);
  });

  it('no inquiry API → unknown; the row stays processing and nothing is charged, voided or refunded', async () => {
    const repo = new ConnectedRepo();
    const { p, calls } = spyProcessor('no-api');
    const svc = new CheckoutService(repo, undefined, undefined, p);
    await strand(svc, repo);
    expect((await svc.reconcileStrandedCard(owner.tenantId, owner.branchId, TK)).status).toBe('unknown');
    expect((await repo.cardPaymentsForTicket(owner, TK))[0].status).toBe('processing');
    expect(calls).toEqual({ charge: 1, inquire: 0, void: 0, refund: 0 });
    expect(await svc.inquireProcessor(owner.tenantId, owner.branchId, TK)).toEqual({ kind: 'no_inquiry', processor: 'spy' });
  });

  it('inquireProcessor reports unreachable honestly and never charges', async () => {
    const { p, calls } = spyProcessor('unreachable');
    const svc = new CheckoutService(new ConnectedRepo(), undefined, undefined, p);
    expect(await svc.inquireProcessor(owner.tenantId, owner.branchId, TK)).toMatchObject({ kind: 'unreachable', processor: 'spy' });
    expect(calls.charge).toBe(0);
  });

  it('a cashier holding the ticket\'s checkout lock → busy (the sweep tries next tick)', async () => {
    const repo = new ConnectedRepo();
    const { p } = spyProcessor(() => ({ transactions: [] }));
    const locks: any = {
      async getStatus() { return null; },
      async acquire() { const { LockHeldElsewhereError } = await import('../checkout-lock/checkout-lock.service'); throw new LockHeldElsewhereError({ source: 'pos' } as any, 'held'); },
      async release() { return { released: true }; },
    };
    const svc = new CheckoutService(repo, undefined, undefined, p, undefined, undefined, undefined, undefined, locks);
    expect(await svc.reconcileStrandedCard(owner.tenantId, owner.branchId, TK)).toEqual({ status: 'busy', ticketId: TK });
  });
});
