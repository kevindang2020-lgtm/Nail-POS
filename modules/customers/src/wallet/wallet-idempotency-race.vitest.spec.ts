// wallet-idempotency-race.vitest.spec.ts — B-79 (Oct 23 2026): the real-Postgres top-up race test found that two settlers
// could both pass the "already posted?" check; the unique (tenant_id, idempotency_key) index let ONE insert win and the
// other got a raw unique violation (a 500). The loser is the same posting: credit / debit now answer with the winner.
import { describe, it, expect } from 'vitest';
import { WalletLedgerService } from './wallet.service';

function racingRepo(kind: 'credit' | 'debit') {
  const winner = { id: 'w1', tenantId: 'T', customerId: 'c1', amountCents: kind === 'credit' ? 5000 : -5000, entryType: kind === 'credit' ? 'top_up' : 'payment', currency: 'USD', reference: null, idempotencyKey: 'k1', createdAt: new Date().toISOString() } as any;
  let finds = 0;
  return {
    findByIdempotencyKey: async () => (finds++ === 0 ? null : winner),   // first look: nothing yet (the other settler is mid-insert)
    insertEntry: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "uq_customer_wallet_ledger_idem"'), { code: '23505' }); },
    postDebitAtomic: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint "uq_customer_wallet_ledger_idem"'), { code: '23505' }); },
  } as any;
}

describe('wallet ledger — a lost idempotency race answers with the winning posting', () => {
  it('credit', async () => {
    expect(await new WalletLedgerService(racingRepo('credit')).credit('T', 'c1', { amountCents: 5000, idempotencyKey: 'k1' })).toMatchObject({ id: 'w1' });
  });
  it('debit', async () => {
    expect(await new WalletLedgerService(racingRepo('debit')).debit('T', 'c1', { amountCents: 5000, idempotencyKey: 'k1' })).toMatchObject({ id: 'w1' });
  });
  it('any other insert error still throws (never swallowed)', async () => {
    const repo = { findByIdempotencyKey: async () => null, insertEntry: async () => { throw new Error('connection reset'); } } as any;
    await expect(new WalletLedgerService(repo).credit('T', 'c1', { amountCents: 5000, idempotencyKey: 'k1' })).rejects.toThrow('connection reset');
  });
});
