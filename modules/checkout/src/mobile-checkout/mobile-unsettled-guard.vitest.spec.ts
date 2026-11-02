// mobile-unsettled-guard.vitest.spec.ts — Secure Tap to Pay §33 / §34 / §64 (POS vs phone concurrency), BOTH directions,
// through the two real services (Oct 26 2026). The Oct 23 engineering report cited this file before it existed.
//
//   POS → phone : a POS card whose answer is unknown ('processing'), a POS split reservation mid-air, or another phone's
//                 Tap to Pay attempt that timed out after authorization was asked → the phone's proceed, new intent and
//                 cash tender are refused PAYMENT_STATUS_UNKNOWN (never "declined", nothing recorded, audited).
//   phone → POS : a Tap to Pay attempt in flight on the phone (tap in progress, authorization pending, unknown) → the POS
//                 card / cash / gift card on the same ticket are refused PAYMENT_STATUS_UNKNOWN and nothing is recorded.
//   fail closed : the unsettled-tender read itself fails → neither surface takes money.
//
// ONE "payment_attempts table": in PostgreSQL both surfaces read checkout/unsettled-tenders.ts over the same table (that SQL is
// proven on the real schema in skip-line-recovery.pgtest.vitest.spec.ts, incl. a Tap to Pay 'authorization_pending' and a
// 'timed_out' row). Here the in-memory POS repository is given the phone's attempt repository as that shared table, filtered
// by the SAME predicate the SQL uses (attemptStatusUnsettled). The pilot (phase 12 S10) proves both directions over HTTP.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CheckoutService } from '../checkout/checkout.service';
import { InMemoryCheckoutRepository, type CheckoutContext } from '../checkout/checkout.repository';
import { attemptStatusUnsettled, type UnsettledTender } from '../checkout/unsettled-tenders';
import { MobileCheckoutService, AttemptError, mobileUnsettledBlock } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import type { PaymentAttemptState } from './payment-attempt-state';

const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment',
  'mobile_checkout.login', 'mobile_checkout.take_payment', 'mobile_checkout.split_payment'];
const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS };
const TK = 'tk_2041';

/** the POS repository reading the phone's attempts as the shared payment_attempts table (same predicate as the SQL view) */
class SharedTableCheckoutRepository extends InMemoryCheckoutRepository {
  constructor(private readonly phone: InMemoryMobilePaymentAttemptRepository) { super(); }
  async unsettledTendersForTicket(c: CheckoutContext, ticketId: string, opts: { exceptPaymentId?: string | null } = {}): Promise<UnsettledTender[]> {
    const own = await super.unsettledTendersForTicket(c, ticketId, opts);
    const phone = (await this.phone.listForTicket(c as any, ticketId)).filter((a) => attemptStatusUnsettled(a.status))
      .map((a) => ({ kind: 'attempt' as const, id: a.id, method: a.method, status: a.status, amountCents: a.amountCents, createdAt: a.createdAt ?? new Date().toISOString(), idempotencyKey: a.idempotencyKey }));
    return [...own, ...phone];
  }
}

function world() {
  const attempts = new InMemoryMobilePaymentAttemptRepository();
  const repo = new SharedTableCheckoutRepository(attempts);
  const pos = new CheckoutService(repo);
  const audit = { record: vi.fn() };
  const recorder = { recordTender: vi.fn(async () => ({ paymentId: 'p-cash', ticketPaid: false, duplicate: false, remainingCents: 0 })) };
  const locks = { getStatus: async () => ({ ownedByCaller: true }), active: async () => null } as any;
  const phone = new MobileCheckoutService(undefined as any, { resolve: async () => null } as any, pos, locks, attempts, undefined, undefined, undefined, undefined, { audit, recorder: recorder as any });
  vi.spyOn(phone as any, 'getTicketDetail').mockResolvedValue({ version: 'v1', balanceDueCents: 7500, paidCents: 0, totals: { totalDueCents: 7500, subtotalCents: 7500, tipCents: 0 } });
  vi.spyOn(phone as any, 'getReadiness').mockResolvedValue({ canTakePayment: true, overall: 'ready', checks: [] });
  return { attempts, repo, pos, phone, audit, recorder };
}
const posCardUnknown = (repo: InMemoryCheckoutRepository) => repo.recordPayment(ctx, { paymentId: 'p-pos-unk', ticketId: TK, method: 'card', amountCents: 7500, tipCents: 0, status: 'processing', createdAt: new Date().toISOString(), idempotencyKey: 'pos-unk-1' });
const phoneCannot = async (phone: MobileCheckoutService, key: string) => {
  const proceed = await phone.evaluateProceed(ctx as any, TK, { sessionId: 's1' });
  const intent = await phone.createAttempt(ctx as any, TK, { sessionId: 's1', idempotencyKey: key }).then(() => null, (e) => e);
  const cash = await phone.recordCashTender(ctx as any, TK, { sessionId: 's1', idempotencyKey: `${key}-cash`, amountCents: 1000 }).then(() => null, (e) => e);
  return { proceed, intent, cash };
};
/** walk a phone attempt through the real state machine to `to` */
async function phoneAttemptAt(attempts: InMemoryMobilePaymentAttemptRepository, phone: MobileCheckoutService, key: string, to: PaymentAttemptState) {
  await phone.createAttempt(ctx as any, TK, { sessionId: 's-phone', idempotencyKey: key });
  const path: PaymentAttemptState[] = ['readiness_checking', 'ready', 'reader_initializing', 'awaiting_customer_tap', 'card_detected', 'authorization_pending', 'unknown'];
  for (const s of path.slice(0, path.indexOf(to) + 1)) await attempts.updateStatus(ctx.tenantId, key, s);
  expect((await attempts.findByKey(ctx.tenantId, key))?.status).toBe(to);
}

beforeEach(() => vi.restoreAllMocks());

describe('§64 POS → phone: a POS card that may still land blocks every phone money path', () => {
  it('a POS card UNKNOWN (processing) → proceed / new intent / phone cash all PAYMENT_STATUS_UNKNOWN; no intent, no cash recorded; audited', async () => {
    const { repo, phone, attempts, audit, recorder } = world();
    await posCardUnknown(repo);
    const r = await phoneCannot(phone, 'K-a');
    expect(r.proceed).toMatchObject({ canProceed: false, reason: 'PAYMENT_STATUS_UNKNOWN' });
    expect(r.proceed.idempotencyKey).toBeUndefined();
    expect(r.intent).toBeInstanceOf(AttemptError); expect(r.intent.code).toBe('PAYMENT_STATUS_UNKNOWN');
    expect(r.cash).toBeInstanceOf(AttemptError); expect(r.cash.code).toBe('PAYMENT_STATUS_UNKNOWN');
    expect(await attempts.listForTicket(ctx as any, TK)).toEqual([]);
    expect(recorder.recordTender).not.toHaveBeenCalled();
    const blocked = audit.record.mock.calls.filter(([, ev]) => ev.action === 'mobile_payment_blocked_unsettled_tender');
    expect(blocked.length).toBe(3);
    expect(blocked[0][1].metadata).toMatchObject({ kind: 'payment', status: 'processing', code: 'PAYMENT_STATUS_UNKNOWN' });
  });

  it('a POS split card reservation mid-air (processing) blocks the phone the same way', async () => {
    const { repo, phone } = world();
    await repo.claimPaymentAttempt(ctx, { ticketId: TK, method: 'card', amountCents: 3000, idempotencyKey: `split-${TK}-1` });
    const r = await phoneCannot(phone, 'K-b');
    expect([r.proceed.reason, r.intent?.code, r.cash?.code]).toEqual(['PAYMENT_STATUS_UNKNOWN', 'PAYMENT_STATUS_UNKNOWN', 'PAYMENT_STATUS_UNKNOWN']);
  });

  it('another phone\'s attempt that TIMED OUT after authorization was asked is unknown, not over → this phone is blocked', async () => {
    const { attempts, phone } = world();
    await phoneAttemptAt(attempts, phone, 'K-other', 'authorization_pending');
    await attempts.updateStatus(ctx.tenantId, 'K-other', 'timed_out');
    const r = await phoneCannot(phone, 'K-c');
    expect([r.proceed.reason, r.intent?.code, r.cash?.code]).toEqual(['PAYMENT_STATUS_UNKNOWN', 'PAYMENT_STATUS_UNKNOWN', 'PAYMENT_STATUS_UNKNOWN']);
  });

  it('settled POS payments block nothing: after Verify approves the POS card there is no unsettled tender (the phone is free to proceed)', async () => {
    const { repo, phone } = world();
    await posCardUnknown(repo);
    await repo.finalizePayment(ctx, 'p-pos-unk', { status: 'declined' });
    const proceed = await phone.evaluateProceed(ctx as any, TK, { sessionId: 's1' });
    expect(proceed.reason).not.toBe('PAYMENT_STATUS_UNKNOWN');
    expect(proceed.canProceed).toBe(true);
  });
});

describe('§64 phone → POS: a Tap to Pay attempt in flight blocks the POS card / cash / gift card', () => {
  for (const state of ['awaiting_customer_tap', 'authorization_pending', 'unknown'] as const) {
    it(`phone attempt '${state}' → POS payCard, payCash and payGiftCard refused PAYMENT_STATUS_UNKNOWN; nothing recorded`, async () => {
      const { attempts, repo, pos, phone } = world();
      await phoneAttemptAt(attempts, phone, `K-${state}`, state);
      const before = (await repo.paymentsForTicket(ctx, TK)).length;
      await expect(pos.payCard(ctx, TK, { idempotencyKey: `pos-card-${state}`, cardToken: '9418594164541111', expiry: '1230' } as any)).rejects.toThrow('PAYMENT_STATUS_UNKNOWN');
      await expect(pos.payCash(ctx, TK, { amountReceivedCents: 100000 } as any)).rejects.toThrow('PAYMENT_STATUS_UNKNOWN');
      await expect(pos.payGiftCard(ctx, TK, { giftCardCode: 'GIFT-50' } as any)).rejects.toThrow('PAYMENT_STATUS_UNKNOWN');
      expect((await repo.paymentsForTicket(ctx, TK)).length).toBe(before);
      expect(await repo.paidTotalCents(ctx, TK)).toBe(0);
    });
  }

  it('once Verify resolves the phone attempt (canceled — never reached the processor) the POS may take the payment', async () => {
    const { attempts, pos, phone } = world();
    await phoneAttemptAt(attempts, phone, 'K-done', 'unknown');
    await attempts.updateStatus(ctx.tenantId, 'K-done', 'canceled');
    const cash = await pos.payCash(ctx, TK, { amountReceivedCents: 100000 } as any);
    expect(cash.payment.status).toBe('approved');
  });
});

describe('§34 fail closed: an unreadable unsettled-tender view takes no money on either surface', () => {
  it('phone: proceed, intent and cash throw the read error (never a "go ahead"); nothing recorded', async () => {
    const { repo, phone, attempts, recorder } = world();
    vi.spyOn(repo, 'unsettledTendersForTicket').mockRejectedValue(new Error('db read failed'));
    await expect(phone.evaluateProceed(ctx as any, TK, { sessionId: 's1' })).rejects.toThrow('db read failed');
    await expect(phone.createAttempt(ctx as any, TK, { sessionId: 's1', idempotencyKey: 'K-f' })).rejects.toThrow('db read failed');
    await expect(phone.recordCashTender(ctx as any, TK, { sessionId: 's1', idempotencyKey: 'K-f', amountCents: 1000 })).rejects.toThrow('db read failed');
    expect(await attempts.listForTicket(ctx as any, TK)).toEqual([]);
    expect(recorder.recordTender).not.toHaveBeenCalled();
  });

  it('POS: cash / gift / card throw the read error; no payment row', async () => {
    const { repo, pos } = world();
    vi.spyOn(repo, 'unsettledTendersForTicket').mockRejectedValue(new Error('db read failed'));
    await expect(pos.payCash(ctx, TK, { amountReceivedCents: 100000 } as any)).rejects.toThrow('db read failed');
    await expect(pos.payGiftCard(ctx, TK, { giftCardCode: 'GIFT-50' } as any)).rejects.toThrow('db read failed');
    await expect(pos.payCard(ctx, TK, { idempotencyKey: 'pos-card-f', cardToken: '9418594164541111', expiry: '1230' } as any)).rejects.toThrow('db read failed');
    expect(await repo.paymentsForTicket(ctx, TK)).toEqual([]);
  });
});

describe('the pure decision (mobileUnsettledBlock): UNKNOWN beats IN_PROGRESS; pre-processor intents and the caller\'s own key block nothing', () => {
  const t = (kind: UnsettledTender['kind'], status: string, idempotencyKey?: string): UnsettledTender => ({ kind, id: status, method: 'card', status, amountCents: 1, createdAt: '2026-10-26T00:00:00Z', idempotencyKey });
  it('table', () => {
    expect(mobileUnsettledBlock([t('payment', 'processing')])).toMatchObject({ code: 'PAYMENT_STATUS_UNKNOWN' });
    expect(mobileUnsettledBlock([t('attempt', 'timed_out')])).toMatchObject({ code: 'PAYMENT_STATUS_UNKNOWN' });
    expect(mobileUnsettledBlock([t('attempt', 'awaiting_customer_tap')])).toMatchObject({ code: 'PAYMENT_IN_PROGRESS' });
    expect(mobileUnsettledBlock([t('attempt', 'awaiting_customer_tap'), t('app_intent', 'processing')])).toMatchObject({ code: 'PAYMENT_STATUS_UNKNOWN' });
    expect(mobileUnsettledBlock([t('attempt', 'ready')])).toBeNull();
    expect(mobileUnsettledBlock([t('attempt', 'unknown', 'mine')], 'mine')).toBeNull();
  });
});
