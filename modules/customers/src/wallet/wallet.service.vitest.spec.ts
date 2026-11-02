import { describe, it, expect, beforeEach } from 'vitest';
import { WalletLedgerService } from './wallet.service';
import { InMemoryWalletLedgerRepository } from './wallet.repository';
import { WalletError } from './wallet-ledger';

const T = 'tenant-1', C = 'cust-1', OTHER = 'cust-2';

describe('WalletLedgerService', () => {
  let svc: WalletLedgerService;
  beforeEach(() => { svc = new WalletLedgerService(new InMemoryWalletLedgerRepository()); });

  it('credits and debits move the balance; balance is derived from entries', async () => {
    await svc.credit(T, C, { amountCents: 50000, type: 'top_up' });
    expect((await svc.getWallet(T, C)).balanceCents).toBe(50000);
    await svc.debit(T, C, { amountCents: 35000, reference: 'ticket_1' });
    const w = await svc.getWallet(T, C);
    expect(w.balanceCents).toBe(15000);
    expect(w.transactions).toHaveLength(2);
    expect(w.transactions[0].type).toBe('payment');   // newest first
    expect(w.transactions[0].amountCents).toBe(-35000); // debit stored negative
  });

  it('refuses to overdraw and posts nothing on insufficient funds', async () => {
    await svc.credit(T, C, { amountCents: 15000 });
    await expect(svc.debit(T, C, { amountCents: 99999 })).rejects.toMatchObject({ code: 'insufficient_funds' });
    const w = await svc.getWallet(T, C);
    expect(w.balanceCents).toBe(15000);                 // unchanged
    expect(w.transactions).toHaveLength(1);             // no debit row created
  });

  it('is idempotent: a repeated idempotency key never double-posts', async () => {
    const a = await svc.credit(T, C, { amountCents: 5000, idempotencyKey: 'topup-abc' });
    const b = await svc.credit(T, C, { amountCents: 5000, idempotencyKey: 'topup-abc' });
    expect(b.id).toBe(a.id);
    expect((await svc.getWallet(T, C)).balanceCents).toBe(5000); // credited once
  });

  it('rejects invalid amounts', async () => {
    await expect(svc.credit(T, C, { amountCents: 0 })).rejects.toBeInstanceOf(WalletError);
    await expect(svc.credit(T, C, { amountCents: -100 })).rejects.toBeInstanceOf(WalletError);
    await expect(svc.debit(T, C, { amountCents: 1.5 })).rejects.toBeInstanceOf(WalletError);
  });

  it('is tenant + customer scoped (another customer’s credit is not counted)', async () => {
    await svc.credit(T, C, { amountCents: 10000 });
    await svc.credit(T, OTHER, { amountCents: 99999 });
    expect((await svc.getWallet(T, C)).balanceCents).toBe(10000);
  });
});
