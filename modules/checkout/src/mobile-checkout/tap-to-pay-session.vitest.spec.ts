import { describe, it, expect } from 'vitest';
import { FiservCommerceHubTtpAdapter } from './fiserv-commercehub-ttp.adapter';
import { NoopTapToPaySessionAdapter, TapToPayNotConfiguredError, TapToPayNotImplementedError } from './tap-to-pay-session';
import { MobileCheckoutService, AttemptError } from './mobile-checkout.service';
import type { Ctx } from '@aipowersalon/permissions';
import type { FiservTtpConfig } from './ttp-config';

const cfg: FiservTtpConfig = { apiKey: 'k', apiSecret: 's', merchantId: 'm', terminalProfileId: 't', environment: 'sandbox', currency: 'USD' };
const mint = { tenantId: 'T1', idempotencyKey: 'K1', amountCents: 3233, currency: 'USD' };
const fin = { tenantId: 'T1', idempotencyKey: 'K1', processorRef: 'R1', amountCents: 3233 };

describe('Tap to Pay session adapters — never fabricate a session', () => {
  it('Noop adapter is unconfigured and throws NotConfigured', async () => {
    const a = new NoopTapToPaySessionAdapter();
    expect(a.isConfigured()).toBe(false);
    await expect(a.mintDeviceSession(mint)).rejects.toBeInstanceOf(TapToPayNotConfiguredError);
    await expect(a.finalizeTransaction(fin)).rejects.toBeInstanceOf(TapToPayNotConfiguredError);
  });

  it('CommerceHub adapter without credentials throws NotConfigured', async () => {
    const a = new FiservCommerceHubTtpAdapter(null);
    expect(a.isConfigured()).toBe(false);
    await expect(a.mintDeviceSession(mint)).rejects.toBeInstanceOf(TapToPayNotConfiguredError);
    await expect(a.finalizeTransaction(fin)).rejects.toBeInstanceOf(TapToPayNotConfiguredError);
  });

  it('CommerceHub adapter WITH credentials is configured but does NOT fake a session (NotImplemented)', async () => {
    const a = new FiservCommerceHubTtpAdapter(cfg, null); // no charges client wired → the seams fail honestly
    expect(a.isConfigured()).toBe(true);
    await expect(a.mintDeviceSession(mint)).rejects.toBeInstanceOf(TapToPayNotImplementedError);
    await expect(a.finalizeTransaction(fin)).rejects.toBeInstanceOf(TapToPayNotImplementedError);
  });

  it('finalizeTransaction charges the captured PaymentSession via the injected CommerceHub client', async () => {
    const charges: any = {
      name: 'commercehub',
      authorizeAndCapture: async (i: any) => ({ approved: true, declined: false, retref: 'TXN9', authCode: 'OK', respstat: '000', respText: 'APPROVAL', amountCents: i.amountCents }),
      refund: async () => ({ ok: true, respstat: '', respText: '' }),
      voidTransaction: async () => ({ ok: true, respstat: '', respText: '' }),
    };
    const a = new FiservCommerceHubTtpAdapter(cfg, charges);
    const r = await a.finalizeTransaction({ tenantId: 'T1', idempotencyKey: 'K1', processorRef: 'sess_abc', amountCents: 1204 });
    expect(r).toMatchObject({ verified: true, processorRef: 'TXN9', capturedAmountCents: 1204 });
  });

  it('mintDeviceSession starts a PaymentSession via the injected CommerceHub client', async () => {
    const client: any = { createSession: async () => ({ sessionId: 'SESS1', accessToken: 'AT1', publicKey: 'PK1', expiresInSeconds: 1500 }) };
    const a = new FiservCommerceHubTtpAdapter(cfg, client);
    const s = await a.mintDeviceSession(mint);
    expect(s).toMatchObject({ provider: 'fiserv_commercehub', sessionToken: 'SESS1', accessToken: 'AT1', publicKey: 'PK1', environment: 'sandbox' });
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(Date.now()); // ~25 min out
  });
});

// ── Service mintDeviceSession: validates the attempt then delegates to the port; never returns a fabricated token.
const attemptsPort = (attempt: any): any => ({ findByKey: async () => attempt });
const buildSvc = (attempt: any, ttp: any) => new MobileCheckoutService({} as any, {} as any, {} as any, {} as any, attemptsPort(attempt), undefined, undefined, ttp);
const ctx: Ctx = { tenantId: 'T1', branchId: 'B1', userId: 'u1', role: 'MANAGER', permissions: [] };

describe('MobileCheckoutService.mintDeviceSession', () => {
  it('404s when the attempt does not exist', async () => {
    await expect(buildSvc(null, new NoopTapToPaySessionAdapter()).mintDeviceSession(ctx, 'K1')).rejects.toBeInstanceOf(AttemptError);
  });
  it('rejects when the attempt is not ready', async () => {
    const svc = buildSvc({ idempotencyKey: 'K1', amountCents: 3233, status: 'created' }, new NoopTapToPaySessionAdapter());
    await expect(svc.mintDeviceSession(ctx, 'K1')).rejects.toBeInstanceOf(AttemptError);
  });
  it('a ready attempt yields an HONEST not-configured error, never a token, when Tap to Pay is off', async () => {
    const svc = buildSvc({ idempotencyKey: 'K1', amountCents: 3233, status: 'ready' }, new NoopTapToPaySessionAdapter());
    await expect(svc.mintDeviceSession(ctx, 'K1')).rejects.toBeInstanceOf(TapToPayNotConfiguredError);
  });
  it('a ready attempt with CommerceHub credentials surfaces NotImplemented (still no fabricated token)', async () => {
    const svc = buildSvc({ idempotencyKey: 'K1', amountCents: 3233, status: 'ready' }, new FiservCommerceHubTtpAdapter(cfg));
    await expect(svc.mintDeviceSession(ctx, 'K1')).rejects.toBeInstanceOf(TapToPayNotImplementedError);
  });
});
