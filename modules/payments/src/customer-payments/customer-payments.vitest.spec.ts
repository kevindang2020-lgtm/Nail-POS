import { WalletLedgerService, InMemoryWalletLedgerRepository } from '@aipowersalon/customers';
import { describe, it, expect } from 'vitest';
import { CustomerPaymentMethodsService, WalletTopupService } from './customer-payments.service';

const ctx = { tenantId: 'T', userId: 'U' };

function methodsRepo() {
  const rows: any[] = []; let n = 0;
  return {
    rows,
    resolveCustomerId: async () => 'c1',
    list: async () => rows.map((r) => ({ id: r.id, brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear, isDefault: r.isDefault })),
    add: async (_t: string, _c: string, i: any) => { const r = { id: `pm${++n}`, brand: i.brand ?? null, last4: i.last4 ?? null, expMonth: i.expMonth ?? null, expYear: i.expYear ?? null, isDefault: !!i.isDefault, token: i.token }; rows.push(r); return { id: r.id, brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear, isDefault: r.isDefault }; },
    remove: async (_t: string, _c: string, id: string) => { const i = rows.findIndex((r) => r.id === id); if (i < 0) return false; rows.splice(i, 1); return true; },
    setDefault: async (_t: string, _c: string, id: string) => { if (!rows.some((r) => r.id === id)) return false; rows.forEach((r) => (r.isDefault = r.id === id)); return true; },
    getToken: async (_t: string, _c: string, id: string) => { const r = rows.find((x) => x.id === id); return r ? { token: r.token, expMonth: r.expMonth, expYear: r.expYear } : null; },
  } as any;
}
const resolverWith = (processor: any) => ({ resolve: async () => ({ processor, processorType: processor ? 'fiserv' : 'none', environment: 'sandbox', merchantIdMasked: '', status: processor ? 'active' : 'not_configured', configured: !!processor }) }) as any;
const approver = { authorizeAndCapture: async () => ({ approved: true, declined: false, retref: 'RT-1', respstat: 'A', respText: 'Approved' }) };
const decliner = { authorizeAndCapture: async () => ({ approved: false, declined: true, retref: 'RT-2', respstat: 'C', respText: 'Declined' }) };

describe('CustomerPaymentMethodsService', () => {
  // (was a raw test-card number '4111111111111111' stored as the "token" — the very bug the PCI refusal now blocks)
  it('adds a tokenized card (last4 derived, PAN never stored), lists, defaults, removes', async () => {
    const repo = methodsRepo();
    const svc = new CustomerPaymentMethodsService(repo);
    const m = await svc.add(ctx, { token: '9418594164541111', brand: 'Visa', expMonth: 12, expYear: 2030, isDefault: true });
    expect(m.last4).toBe('1111');
    expect((await svc.list(ctx))).toHaveLength(1);
    // F1 §50 (Nov 6 2026): neither the add answer nor the list ever carries the provider token
    expect(JSON.stringify(m)).not.toContain('9418594164541111');
    expect(JSON.stringify(await svc.list(ctx))).not.toContain('9418594164541111');
    expect(repo.rows[0].token).toBe('9418594164541111'); // token kept internally
    expect((await svc.setDefault(ctx, m.id)).ok).toBe(true);
    expect((await svc.remove(ctx, m.id)).ok).toBe(true);
    expect(await svc.list(ctx)).toHaveLength(0);
  });
  it('requires a token to add', async () => {
    await expect(new CustomerPaymentMethodsService(methodsRepo()).add(ctx, { token: '   ' } as any)).rejects.toBeTruthy();
  });
});

describe('WalletTopupService', () => {
  it('charges the saved card and credits the ledger only on approval (idempotent on retref)', async () => {
    const repo = methodsRepo(); await repo.add('T', 'c1', { token: '4111111111111111', last4: '1111' });
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    const svc = new WalletTopupService(resolverWith(approver), repo, ledger);
    const r = await svc.topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r.ok).toBe(true);
    expect(r.balanceCents).toBe(5000);
  });
  it('does not credit when the card is declined', async () => {
    const repo = methodsRepo(); await repo.add('T', 'c1', { token: '4000000000000002', last4: '0002' });
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    const r = await new WalletTopupService(resolverWith(decliner), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r.ok).toBe(false);
    expect(r.declined).toBe(true);
    expect((await ledger.getWallet('T', 'c1')).balanceCents).toBe(0);
  });
  it('deep-scan (Oct 22 2026): a host retry, an unknown answer or a LOST answer is never "declined" and credits nothing', async () => {
    for (const [proc, re] of [
      [{ authorizeAndCapture: async () => ({ approved: false, declined: false, respstat: 'B', respText: 'retry' }) }, /busy right now — nothing was charged/],
      [{ authorizeAndCapture: async () => ({ approved: false, declined: false, respstat: '', respText: '' }) }, /could not confirm this top-up/],
      [{ authorizeAndCapture: async () => { throw new Error('socket hang up'); } }, /could not confirm this top-up/],
    ] as const) {
      const repo = methodsRepo(); await repo.add('T', 'c1', { token: '9418594164541111', last4: '1111' });
      const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
      const r = await new WalletTopupService(resolverWith(proc as any), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
      expect(r.ok).toBe(false);
      expect(r.declined).toBeUndefined();
      expect(r.message).toMatch(re);
      expect((await ledger.getWallet('T', 'c1')).balanceCents).toBe(0);
    }
  });
  it('rejects invalid amounts, missing methods, and unconfigured gateways', async () => {
    const repo = methodsRepo(); await repo.add('T', 'c1', { token: 'tok', last4: '4242' });
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    expect((await new WalletTopupService(resolverWith(approver), repo, ledger).topUp(ctx, { amountCents: 0, paymentMethodId: 'pm1' })).ok).toBe(false);
    expect((await new WalletTopupService(resolverWith(approver), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'nope' })).ok).toBe(false);
    expect((await new WalletTopupService(resolverWith(undefined), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' })).ok).toBe(false);
  });
});

describe('saved cards: a raw card number never gets stored (PCI)', () => {
  it('looksLikeRawPan: Luhn-valid 13–19 digits not starting with 9 is a card number; a CardSecure token (starts with 9) is not', async () => {
    const { looksLikeRawPan } = await import('./customer-payments.service');
    for (const pan of ['4111111111111111', '4111 1111 1111 1111', '5555555555554444', '378282246310005', '6011111111111117']) expect(looksLikeRawPan(pan), pan).toBe(true);
    for (const tok of ['9418594164541111', '9413948780281111', 'tok_abc123', '4111111111111112' /* fails Luhn */, '12345']) expect(looksLikeRawPan(tok), tok).toBe(false);
  });
  it('add() refuses a card number sent as the "token" — the old customer-app form did exactly that', async () => {
    const { CustomerPaymentMethodsService } = await import('./customer-payments.service');
    const saved: any[] = [];
    const repo: any = { resolveCustomerId: async () => 'c1', add: async (_t: string, _c: string, m: any) => { saved.push(m); return { id: 'pm1', ...m }; } };
    const svc = new CustomerPaymentMethodsService(repo);
    const ctx = { tenantId: 't1', userId: 'u1' } as any;
    await expect(svc.add(ctx, { token: '4111111111111111', last4: '1111' } as any)).rejects.toThrow(/cannot be saved directly/i);
    expect(saved).toEqual([]);
  });
});
