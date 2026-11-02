// Oct 28 2026 (Secure Tap mandate audit, §35 / §36 / §73 / §197): the recovery lookup and the kill switch.
//  • The CommerceHub inquiry is BY THIS ATTEMPT'S ORDER ID. It used to drop every transaction whose retref differed from the
//    stored processorRef — for a phone tap that ref is the PaymentSession id, the retref the transaction id — so the real
//    approved charge read as not_found and the attempt was released for a SECOND charge after 5 minutes.
//  • A kill switch whose very first read fails used to answer "on"; it now fails CLOSED.
import { describe, it, expect } from 'vitest';
import { FiservCommerceHubTtpAdapter } from './fiserv-commercehub-ttp.adapter';
import { KyselyTapToPayKillSwitch } from './ttp-kill-switch';
import { decideRecovery } from './mobile-attempt-recovery';

const CFG = { apiKey: 'k', apiSecret: 's', merchantId: 'm', terminalProfileId: 't', environment: 'sandbox' as const, currency: 'USD' };
const adapterWith = (transactions: any[]) => new FiservCommerceHubTtpAdapter(CFG, { inquireByOrderId: async () => ({ transactions }) } as any);
const ask = (a: FiservCommerceHubTtpAdapter, processorRef: string | null = 'SESSION-abc') => a.lookupTransaction({ tenantId: 't1', idempotencyKey: 'K1', processorRef, amountCents: 6000 });

describe('recovery lookup — the charge under this order is found, whatever the stored ref holds', () => {
  it('an approved transaction whose retref is NOT the stored session id is APPROVED (was: not_found → released → charged twice)', async () => {
    const r = await ask(adapterWith([{ retref: 'CH-TXN-991', approved: true, declined: false, amountCents: 6000 }]));
    expect(r).toEqual({ kind: 'approved', processorRef: 'CH-TXN-991', capturedAmountCents: 6000 });
    expect(decideRecovery(r, { ageMs: 60 * 60_000 }).action).toBe('confirm');
  });
  it('an approval with no retref, or for another amount, is still the approval (the captured amount is reported, not assumed)', async () => {
    expect(await ask(adapterWith([{ approved: true, declined: false }]))).toMatchObject({ kind: 'approved', processorRef: 'SESSION-abc' });
    expect(await ask(adapterWith([{ approved: true, declined: false }]), null)).toMatchObject({ kind: 'approved', processorRef: 'K1' });
    expect(await ask(adapterWith([{ retref: 'X', approved: true, declined: false, amountCents: 5500 }]))).toEqual({ kind: 'approved', processorRef: 'X', capturedAmountCents: 5500 });
  });
  it('an approval wins over an earlier decline under the same order', async () => {
    expect((await ask(adapterWith([{ retref: 'D1', approved: false, declined: true }, { retref: 'A1', approved: true, declined: false }]))).kind).toBe('approved');
  });
  it('only an explicit decline (and no approval) is declined', async () => {
    expect(await ask(adapterWith([{ retref: 'D1', approved: false, declined: true, respText: 'Insufficient funds' }]))).toEqual({ kind: 'declined', processorRef: 'D1', respText: 'Insufficient funds' });
  });
  it('transactions in no final state are NOT "nothing there" — the attempt waits / goes to a person, never released', async () => {
    const r = await ask(adapterWith([{ retref: 'P1', approved: false, declined: false }]));
    expect(r.kind).toBe('unreachable');
    expect(decideRecovery(r, { ageMs: 60 * 60_000 }).action).not.toBe('release');
  });
  it('an empty list is not_found (released only after the window)', async () => {
    expect(await ask(adapterWith([]))).toEqual({ kind: 'not_found' });
  });
});

describe('kill switch — fails closed', () => {
  const downDb = { getExecutor: () => { throw new Error('db down'); } };
  it('a first read that fails answers OFF (platform), not on', async () => {
    expect(await new KyselyTapToPayKillSwitch(downDb).disabledReason('fiserv_commercehub')).toBe('platform');
  });
  it('a failed read keeps the last known value when there is one', async () => {
    let fail = false; let t = 0;
    const db = { getExecutor: () => { if (fail) throw new Error('db down'); return { transformQuery: (n: unknown) => n, compileQuery: () => ({ sql: '', parameters: [] }), executeQuery: async () => ({ rows: [{ value: false }] }), adapter: {} }; } };
    const ks = new KyselyTapToPayKillSwitch(db, 1_000, () => t);
    expect(await ks.disabledReason('fiserv_commercehub')).toBeNull();   // read: on
    fail = true; t = 5_000;                                              // cache expired, the read fails
    expect(await ks.disabledReason('fiserv_commercehub')).toBeNull();   // the last value (on) stands
  });
});
