// Saved cards + wallet top-up — Fiserv master build §4 / §8D (Nov 4 2026): consent + hosted-iFrame token + PROVIDER
// verification + merchant binding are all required; nothing synthetic, no cross-merchant use.
import { WalletLedgerService, InMemoryWalletLedgerRepository } from '@aipowersalon/customers';
import { describe, it, expect, vi } from 'vitest';
import { CustomerPaymentMethodsService, WalletTopupService, SAVED_CARD_CONSENT_VERSION } from './customer-payments.service';

const ctx = { tenantId: 'T', userId: 'U' };
const MID_HASH = 'hash-of-mid-A';
const consent = { consent: true, consentVersion: SAVED_CARD_CONSENT_VERSION };

function methodsRepo() {
  const rows: any[] = []; let n = 0;
  return {
    rows,
    resolveCustomerId: async (t: string) => (t === 'T' ? 'c1' : null),
    list: async () => rows.filter((r) => !r.revoked).map((r) => ({ id: r.id, brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear, isDefault: r.isDefault })),
    add: async (_t: string, _c: string, i: any) => { const r = { id: `pm${++n}`, brand: i.brand ?? null, last4: i.last4 ?? null, expMonth: i.expMonth ?? null, expYear: i.expYear ?? null, isDefault: !!i.isDefault, token: i.token, binding: i.binding }; rows.push(r); return { id: r.id, brand: r.brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear, isDefault: r.isDefault }; },
    remove: async (_t: string, _c: string, id: string) => { const r = rows.find((x) => x.id === id && !x.revoked); if (!r) return null; r.revoked = true; return { profileId: r.binding?.profileId ?? null, acctId: r.binding?.acctId ?? null }; },
    setDefault: async (_t: string, _c: string, id: string) => { if (!rows.some((r) => r.id === id)) return false; rows.forEach((r) => (r.isDefault = r.id === id)); return true; },
    getToken: async (_t: string, _c: string, id: string, midHash: string) => { const r = rows.find((x) => x.id === id && !x.revoked && x.binding?.merchantIdHash === midHash); return r ? { token: r.token, expMonth: r.expMonth, expYear: r.expYear } : null; },
  } as any;
}
const provider = (over: Partial<any> = {}) => ({
  authorizeAndCapture: vi.fn(async (i: any) => ({ approved: true, declined: false, retref: 'RT-1', respstat: 'A', respText: 'Approved', amountCents: i.amountCents })),
  createStoredProfile: vi.fn(async (i: any) => ({ ok: true, respstat: 'A', respText: 'Profile Saved', profileId: 'P1', acctId: '1', token: i.account, expiry: '1230' })),
  deleteStoredProfile: vi.fn(async () => ({ ok: true, respText: '' })),
  ...over,
});
const merchants = (processor: any, midHash: string | null = MID_HASH) => ({ effectiveMerchant: vi.fn(async () => ({ configured: !!processor && !!midHash, scope: 'tenant', merchantAccountId: null, merchantIdHash: midHash, processor, environment: 'sandbox' })) }) as any;

describe('CustomerPaymentMethodsService — add card', () => {
  it('provider-verified hosted token + consent → stored with merchant binding and provider profile', async () => {
    const repo = methodsRepo(); const p = provider();
    const svc = new CustomerPaymentMethodsService(repo, merchants(p));
    const m = await svc.add(ctx, { token: '9418594164541111', zipCode: '19406', isDefault: true, ...consent });
    expect(p.createStoredProfile).toHaveBeenCalledWith(expect.objectContaining({ account: '9418594164541111', postal: '19406' }));
    expect(m).toMatchObject({ last4: '1111', expMonth: 12, expYear: 2030 });
    expect(repo.rows[0].binding).toEqual({ merchantAccountId: null, merchantIdHash: MID_HASH, profileId: 'P1', acctId: '1', consentVersion: SAVED_CARD_CONSENT_VERSION, consentScope: 'cit_unscheduled' });
  });
  it('a client-supplied binding is ignored — the service always sets it from the provider result', async () => {
    const repo = methodsRepo();
    await new CustomerPaymentMethodsService(repo, merchants(provider())).add(ctx, { token: '9418594164541111', ...consent, binding: { merchantIdHash: 'other-salon' } } as any);
    expect(repo.rows[0].binding.merchantIdHash).toBe(MID_HASH);
  });
  it.each([
    ['no consent', { token: '9418594164541111' }, /agree to save/],
    ['consent false', { token: '9418594164541111', consent: false, consentVersion: SAVED_CARD_CONSENT_VERSION }, /agree to save/],
    ['stale consent version', { token: '9418594164541111', consent: true, consentVersion: 'old' }, /updated card-saving terms/],
    ['raw card number', { token: '4111111111111111', ...consent }, /cannot be saved directly/],
    ['blank token', { token: '  ', ...consent }, /secure card form/],
    ['not a CardSecure token', { token: 'tok_abc', ...consent }, /could not be read/],
  ])('refuses: %s — nothing stored, provider not called', async (_n, body, msg) => {
    const repo = methodsRepo(); const p = provider();
    await expect(new CustomerPaymentMethodsService(repo, merchants(p)).add(ctx, body as any)).rejects.toThrow(msg);
    expect(repo.rows).toHaveLength(0); expect(p.createStoredProfile).not.toHaveBeenCalled();
  });
  it('a synthetic 9-prefixed string the provider rejects is NOT stored', async () => {
    const repo = methodsRepo(); const p = provider({ createStoredProfile: vi.fn(async () => ({ ok: false, respstat: 'C', respText: 'Invalid account' })) });
    await expect(new CustomerPaymentMethodsService(repo, merchants(p)).add(ctx, { token: '9111111111111111', ...consent })).rejects.toThrow(/did not accept this card/);
    expect(repo.rows).toHaveLength(0);
  });
  it('provider unreachable → not stored, clear message', async () => {
    const repo = methodsRepo(); const p = provider({ createStoredProfile: vi.fn(async () => { throw new Error('ECONNRESET'); }) });
    await expect(new CustomerPaymentMethodsService(repo, merchants(p)).add(ctx, { token: '9418594164541111', ...consent })).rejects.toThrow(/could not be reached/);
    expect(repo.rows).toHaveLength(0);
  });
  it('no usable gateway / no provider verification support → card saving unavailable (no silent fallback)', async () => {
    await expect(new CustomerPaymentMethodsService(methodsRepo()).add(ctx, { token: '9418594164541111', ...consent })).rejects.toThrow(/not available/);
    await expect(new CustomerPaymentMethodsService(methodsRepo(), merchants(null)).add(ctx, { token: '9418594164541111', ...consent })).rejects.toThrow(/not available/);
    const noProfile = provider(); delete (noProfile as any).createStoredProfile;
    await expect(new CustomerPaymentMethodsService(methodsRepo(), merchants(noProfile)).add(ctx, { token: '9418594164541111', ...consent })).rejects.toThrow(/not available/);
  });
  it('a user with no customer row at THIS tenant cannot add (no other-salon fallback)', async () => {
    await expect(new CustomerPaymentMethodsService(methodsRepo(), merchants(provider())).add({ tenantId: 'OTHER', userId: 'U' }, { token: '9418594164541111', ...consent })).rejects.toThrow(/Not a customer/);
  });
  it('remove revokes the row and deletes the provider profile', async () => {
    const repo = methodsRepo(); const p = provider(); const svc = new CustomerPaymentMethodsService(repo, merchants(p));
    const m = await svc.add(ctx, { token: '9418594164541111', ...consent });
    expect((await svc.remove(ctx, m.id)).ok).toBe(true);
    expect(p.deleteStoredProfile).toHaveBeenCalledWith({ profileId: 'P1', acctId: '1' });
    expect(await svc.list(ctx)).toHaveLength(0);
  });
});

describe('WalletTopupService', () => {
  async function seeded(p: any) { const repo = methodsRepo(); await new CustomerPaymentMethodsService(repo, merchants(p)).add(ctx, { token: '9418594164541111', ...consent }); return repo; }
  it('charges a merchant-bound saved card CIT and credits only on approval', async () => {
    const p = provider(); const repo = await seeded(p);
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    const r = await new WalletTopupService(merchants(p), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r).toMatchObject({ ok: true, balanceCents: 5000 });
    expect(p.authorizeAndCapture).toHaveBeenCalledWith(expect.objectContaining({ ecomind: 'E', cof: 'C', cofscheduled: 'N' }));
  });
  it('a card verified at merchant A cannot be charged at merchant B', async () => {
    const p = provider(); const repo = await seeded(p);
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    const r = await new WalletTopupService(merchants(p, 'hash-of-mid-B'), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r.ok).toBe(false); expect(p.authorizeAndCapture).not.toHaveBeenCalled();
  });
  it('declined → no credit; retry/unknown → no credit and not called "declined"', async () => {
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    const dec = provider({ authorizeAndCapture: vi.fn(async () => ({ approved: false, declined: true, respstat: 'C', respText: 'Declined' })) });
    const r1 = await new WalletTopupService(merchants(dec), await seeded(dec), ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r1).toMatchObject({ ok: false, declined: true });
    const unk = provider({ authorizeAndCapture: vi.fn(async () => ({ approved: false, declined: false, respstat: 'B', respText: 'Retry' })) });
    const r2 = await new WalletTopupService(merchants(unk), await seeded(unk), ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r2.ok).toBe(false); expect(r2.declined).toBeFalsy(); expect(r2.message).toMatch(/do not try again/);
    expect((await ledger.getWallet('T', 'c1')).balanceCents).toBe(0);
  });
  it('approved for a different amount → no credit', async () => {
    const p = provider({ authorizeAndCapture: vi.fn(async () => ({ approved: true, declined: false, retref: 'R', respstat: 'A', respText: 'ok', amountCents: 500 })) });
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    const r = await new WalletTopupService(merchants(p), await seeded(p), ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' });
    expect(r.ok).toBe(false); expect((await ledger.getWallet('T', 'c1')).balanceCents).toBe(0);
  });
  it('rejects invalid amounts, missing methods and unconfigured gateways', async () => {
    const p = provider(); const repo = await seeded(p);
    const ledger = new WalletLedgerService(new InMemoryWalletLedgerRepository());
    expect((await new WalletTopupService(merchants(p), repo, ledger).topUp(ctx, { amountCents: 0, paymentMethodId: 'pm1' })).ok).toBe(false);
    expect((await new WalletTopupService(merchants(p), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'nope' })).ok).toBe(false);
    expect((await new WalletTopupService(merchants(null), repo, ledger).topUp(ctx, { amountCents: 5000, paymentMethodId: 'pm1' })).ok).toBe(false);
  });
});

describe('looksLikeRawPan (PCI)', () => {
  it('Luhn-valid 13–19 digits not starting with 9 is a card number; a CardSecure token is not', async () => {
    const { looksLikeRawPan } = await import('./customer-payments.service');
    for (const pan of ['4111111111111111', '4111 1111 1111 1111', '5555555555554444', '378282246310005', '6011111111111117']) expect(looksLikeRawPan(pan), pan).toBe(true);
    for (const tok of ['9418594164541111', 'tok_abc123', '4111111111111112', '12345']) expect(looksLikeRawPan(tok), tok).toBe(false);
  });
});
