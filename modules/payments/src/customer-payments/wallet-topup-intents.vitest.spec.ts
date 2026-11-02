// wallet-topup-intents.vitest.spec.ts — Remaining-work mandate P1-1 / B-79 (Oct 23 2026): a wallet top-up is a durable intent.
// The card is charged with orderId = intent id and a STABLE key; a retry of the same tap never charges again; an unknown
// or lost answer is UNKNOWN (never "declined") and is settled later from the processor's record by Verify / the sweep;
// whoever settles it, the wallet is credited exactly once.
import { WalletLedgerService, InMemoryWalletLedgerRepository } from '@aipowersalon/customers';
import { describe, it, expect } from 'vitest';
import { WalletTopupService } from './customer-payments.service';
import { InMemoryWalletTopupIntentStore, decideTopUp, topUpIntentIdFromOrder } from './wallet-topup-intents';

const ctx = { tenantId: 'T', userId: 'U' };
const MIN = 60_000;
const methods = () => ({
  resolveCustomerId: async () => 'c1',
  getToken: async (_t: string, _c: string, id: string) => (id === 'pm1' ? { token: '9418594164541111', expMonth: 12, expYear: 2030 } : null),
} as any);
const resolverWith = (processor: any) => ({ resolve: async () => ({ processor, configured: !!processor }) } as any);

/** A fake processor that remembers what it was asked and can answer each way; inquireByOrderId replays its own record. */
function proc(answer: 'approve' | 'decline' | 'retry' | 'unknown' | 'throw', opts: { recordAs?: 'approved' | 'declined' | 'none' | 'two' } = {}) {
  const calls: any[] = []; const inquiries: string[] = [];
  return {
    name: 'cardpointe', calls, inquiries,
    async authorizeAndCapture(i: any) {
      calls.push(i);
      if (answer === 'throw') throw new Error('socket hang up');
      if (answer === 'approve') return { approved: true, declined: false, retref: 'RT-' + calls.length, respstat: 'A', respText: 'Approved' };
      if (answer === 'decline') return { approved: false, declined: true, retref: 'RD-' + calls.length, respstat: 'C', respText: 'Insufficient funds' };
      if (answer === 'retry') return { approved: false, declined: false, respstat: 'B', respText: 'Host unavailable' };
      return { approved: false, declined: false, respstat: '', respText: 'Pending', retref: 'RU-1' };
    },
    async inquireByOrderId(orderId: string) {
      inquiries.push(orderId);
      const r = opts.recordAs ?? 'none';
      if (r === 'approved') return { transactions: [{ retref: 'RT-INQ', approved: true, declined: false, amountCents: 5000 }] };
      if (r === 'declined') return { transactions: [{ retref: 'RD-INQ', approved: false, declined: true, amountCents: 5000 }] };
      if (r === 'two') return { transactions: [{ retref: 'A1', approved: true, declined: false, amountCents: 5000 }, { retref: 'A2', approved: true, declined: false, amountCents: 5000 }] };
      return { transactions: [] };
    },
  };
}
function setup(p: any, strandedMs = 15 * MIN, now = () => new Date()) {
  const intents = new InMemoryWalletTopupIntentStore();
  const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
  const svc = new WalletTopupService(resolverWith(p), methods(), ledger, intents, { strandedMs, now });
  return { intents, ledger, svc, balance: async () => (await ledger.getWallet('T', 'c1')).balanceCents };
}

describe('decideTopUp — the processor record decides, only an unambiguous record moves money', () => {
  it('approved / declined / two approvals → review / no record young → wait / old → release / unreachable → wait', () => {
    expect(decideTopUp({ amountCents: 5000, ageMs: 0 }, [{ retref: 'R', approved: true, declined: false, amountCents: 5000 }], 15 * MIN).action).toBe('approved');
    expect(decideTopUp({ amountCents: 5000, ageMs: 0 }, [{ retref: 'R', approved: false, declined: true, amountCents: 5000 }], 15 * MIN).action).toBe('declined');
    expect(decideTopUp({ amountCents: 5000, ageMs: 0 }, [{ retref: 'A', approved: true, declined: false, amountCents: 5000 }, { retref: 'B', approved: true, declined: false, amountCents: 5000 }], 15 * MIN).action).toBe('review');
    expect(decideTopUp({ amountCents: 5000, ageMs: MIN }, [], 15 * MIN).action).toBe('wait');
    expect(decideTopUp({ amountCents: 5000, ageMs: 20 * MIN }, [], 15 * MIN).action).toBe('release');
    expect(decideTopUp({ amountCents: 5000, ageMs: 20 * MIN }, null, 15 * MIN).action).toBe('wait');
    // a charge of ANOTHER amount is never credited as this top-up
    expect(decideTopUp({ amountCents: 5000, ageMs: 20 * MIN }, [{ retref: 'X', approved: true, declined: false, amountCents: 7000 }], 15 * MIN).action).toBe('release');
  });
});

describe('WalletTopupService — the durable intent', () => {
  it('approved: orderId = intent id, a stable key with no clock in it, credit keyed on the intent, intent APPROVED', async () => {
    const p = proc('approve'); const { svc, intents, balance } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-1' });
    expect(r).toMatchObject({ ok: true, status: 'APPROVED', balanceCents: 5000 });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].orderId).toBe(r.intentId);
    expect(p.calls[0].idempotencyKey).toBe(`topup:${r.intentId}:1`);
    expect(intents.rows[0]).toMatchObject({ status: 'APPROVED', processorTransactionId: 'RT-1', settledBy: 'charge', attempt: 1 });
    expect(await balance()).toBe(5000);
  });
  it('the retry of the SAME tap (same client key) never charges again and never credits twice', async () => {
    const p = proc('approve'); const { svc, balance } = setup(p);
    const a = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-1' });
    const b = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-1' });
    expect(b).toMatchObject({ ok: true, intentId: a.intentId, status: 'APPROVED' });
    expect(p.calls).toHaveLength(1);
    expect(await balance()).toBe(5000);
  });
  it('a lost answer → UNKNOWN (never declined); the retry with the same key does NOT charge; Verify finds the approval → credited once', async () => {
    const p = proc('throw', { recordAs: 'approved' }); const { svc, intents, balance } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-2' });
    expect(r).toMatchObject({ ok: false, status: 'UNKNOWN' }); expect(r.declined).toBeUndefined(); expect(r.message).toMatch(/could not confirm/);
    const again = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-2' });
    expect(again).toMatchObject({ ok: false, status: 'UNKNOWN', intentId: r.intentId });
    expect(p.calls).toHaveLength(1);
    const v = await svc.verifyMine(ctx, r.intentId!);
    expect(v).toMatchObject({ ok: true, status: 'APPROVED', balanceCents: 5000 });
    expect(p.inquiries).toEqual([r.intentId]);
    const v2 = await svc.verifyMine(ctx, r.intentId!);   // a second Verify: same answer, no second credit, no inquiry needed
    expect(v2).toMatchObject({ ok: true, status: 'APPROVED', balanceCents: 5000 });
    expect(intents.rows[0]).toMatchObject({ status: 'APPROVED', processorTransactionId: 'RT-INQ', settledBy: 'verify' });
    expect(await balance()).toBe(5000);
    expect(p.calls).toHaveLength(1);
  });
  it('unknown answer + the processor record says declined → DECLINED, nothing credited', async () => {
    const p = proc('unknown', { recordAs: 'declined' }); const { svc, balance } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r.status).toBe('UNKNOWN');
    expect(await svc.verifyForStaff('T', 'c1', r.intentId!)).toMatchObject({ ok: false, status: 'DECLINED', declined: true });
    expect(await balance()).toBe(0);
  });
  it('no record: a young intent waits; an old one is released (FAILED — nothing charged) by the sweep, and may then be retried on the same key with a NEW processor key', async () => {
    let t = Date.now(); const now = () => new Date(t);
    const p = proc('throw', { recordAs: 'none' }); const { svc, intents } = setup(p, 15 * MIN, now);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-3' });
    expect((await svc.verifyMine(ctx, r.intentId!)).status).toBe('UNKNOWN');      // young → wait
    t += 20 * MIN; intents.rows[0].createdAt = new Date(t - 20 * MIN).toISOString();
    const sw = await svc.sweepStranded(new Date(t));
    expect(sw).toMatchObject({ checked: 1, released: 1 });
    expect(intents.rows[0]).toMatchObject({ status: 'FAILED', settledBy: 'sweep' });
    (p as any).authorizeAndCapture = async (i: any) => { p.calls.push(i); return { approved: true, declined: false, retref: 'RT-9', respstat: 'A' }; };
    const retry = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-3' });
    expect(retry).toMatchObject({ ok: true, intentId: r.intentId, status: 'APPROVED' });
    expect(p.calls.map((c) => c.idempotencyKey)).toEqual([`topup:${r.intentId}:1`, `topup:${r.intentId}:2`]);
  });
  it('two approvals for one top-up → review: nothing credited automatically', async () => {
    const p = proc('unknown', { recordAs: 'two' }); const { svc, balance, intents } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect((await svc.verifyMine(ctx, r.intentId!)).message).toMatch(/more than one charge/);
    expect(intents.rows[0].status).toBe('UNKNOWN');
    expect(await balance()).toBe(0);
  });
  it('a host retry is FAILED (nothing charged, not a decline); a decline is DECLINED', async () => {
    const r1 = await setup(proc('retry')).svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r1).toMatchObject({ ok: false, status: 'FAILED' }); expect(r1.declined).toBeUndefined();
    const r2 = await setup(proc('decline')).svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r2).toMatchObject({ ok: false, status: 'DECLINED', declined: true });
  });
  it('the same client key with a different amount is refused, never charged', async () => {
    const p = proc('throw'); const { svc } = setup(p);
    await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1', clientKey: 'tap-4' });
    const r = await svc.topUp(ctx, { amountCents: 9000, paymentMethodId: 'pm1', clientKey: 'tap-4' });
    expect(r.ok).toBe(false);
    expect(p.calls).toHaveLength(1);
  });
  it('another customer cannot Verify my top-up', async () => {
    const p = proc('throw', { recordAs: 'approved' }); const { svc } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(await svc.verifyForStaff('T', 'c-other', r.intentId!)).toMatchObject({ ok: false, message: 'Top-up not found.' });
    expect(p.inquiries).toEqual([]);
  });
});

// §15 / §16 / §58 (Oct 27 2026): the processor's webhook is the fourth settler of the same intent.
describe('settleFromWebhook — the webhook leg settles the same intent, one credit', () => {
  it('topUpIntentIdFromOrder: bare id, topup:<id>, topup:<id>:<attempt>; junk → null', () => {
    expect(topUpIntentIdFromOrder('tui-1')).toBe('tui-1');
    expect(topUpIntentIdFromOrder('topup:tui-1')).toBe('tui-1');
    expect(topUpIntentIdFromOrder('topup:tui-1:2')).toBe('tui-1');
    expect(topUpIntentIdFromOrder('')).toBeNull();
    expect(topUpIntentIdFromOrder("x'; drop table")).toBeNull();
  });
  it('lost answer → an approved webhook of the same amount settles it (settled_by webhook) and credits once; a replay and a later Verify add nothing', async () => {
    const p = proc('throw', { recordAs: 'approved' }); const { svc, intents, balance } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r).toMatchObject({ status: 'UNKNOWN' });
    const w1 = await svc.settleFromWebhook('T', r.intentId!, { approved: true, declined: false, retref: 'RT-WH', amountCents: 5000 });
    expect(w1).toMatchObject({ matched: true, status: 'APPROVED', settledByThis: true });
    expect(await balance()).toBe(5000);
    const w2 = await svc.settleFromWebhook('T', `topup:${r.intentId}:1`, { approved: true, declined: false, retref: 'RT-WH', amountCents: 5000 });
    expect(w2).toMatchObject({ matched: true, status: 'APPROVED', settledByThis: false });
    expect(await svc.verifyForStaff('T', 'c1', r.intentId!)).toMatchObject({ ok: true, status: 'APPROVED' });
    expect(await balance()).toBe(5000);
    expect(intents.rows[0]).toMatchObject({ status: 'APPROVED', settledBy: 'webhook', processorTransactionId: 'RT-WH' });
    expect(p.calls).toHaveLength(1);
  });
  it('Verify first, webhook second → still one credit (the webhook finds it settled)', async () => {
    const p = proc('throw', { recordAs: 'approved' }); const { svc, balance } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    await svc.verifyMine(ctx, r.intentId!);
    const w = await svc.settleFromWebhook('T', r.intentId!, { approved: true, declined: false, retref: 'RT-INQ', amountCents: 5000 });
    expect(w).toMatchObject({ matched: true, status: 'APPROVED', settledByThis: false });
    expect(await balance()).toBe(5000);
  });
  it('a declined webhook settles DECLINED, nothing credited', async () => {
    const { svc, balance } = setup(proc('throw'));
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(await svc.settleFromWebhook('T', r.intentId!, { approved: false, declined: true, retref: 'RD-WH', amountCents: 5000 })).toMatchObject({ status: 'DECLINED', settledByThis: true });
    expect(await balance()).toBe(0);
  });
  it('a webhook of ANOTHER amount is not decisive: it only nudges a Verify (the processor record decides)', async () => {
    const p = proc('throw', { recordAs: 'none' }); const { svc, balance } = setup(p);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    const w = await svc.settleFromWebhook('T', r.intentId!, { approved: true, declined: false, retref: 'RX', amountCents: 9999 });
    expect(w).toMatchObject({ matched: true, status: 'UNKNOWN' });
    expect(p.inquiries).toEqual([r.intentId]);
    expect(await balance()).toBe(0);
  });
  it('an order that is not a top-up of THIS salon is not matched', async () => {
    const { svc } = setup(proc('throw'));
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(await svc.settleFromWebhook('OTHER', r.intentId!, { approved: true, declined: false, retref: 'R', amountCents: 5000 })).toEqual({ matched: false });
    expect(await svc.settleFromWebhook('T', 'ticket-123', { approved: true, declined: false, retref: 'R', amountCents: 5000 })).toEqual({ matched: false });
  });
});
