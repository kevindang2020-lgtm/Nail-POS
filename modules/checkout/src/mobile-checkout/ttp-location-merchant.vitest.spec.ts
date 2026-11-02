// ttp-location-merchant.vitest.spec.ts — Tap to Pay per location (migration 704, Kevin's decision Oct 28 2026).
// Each location charges Tap to Pay through ITS OWN CommerceHub merchant id; never another location's, never the
// platform's env MID in production.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { FiservCommerceHubTtpAdapter } from './fiserv-commercehub-ttp.adapter';
import { InMemoryCheckoutRepository } from '../checkout/checkout.repository';
import { CheckoutService } from '../checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';
import { InMemoryMobilePaymentAttemptRepository } from './mobile-payment-attempt.repository';
import { InMemoryTtpOnboardingStore } from './ttp-onboarding';
import { InMemoryMobilePayDeviceStore } from './mobile-pay-device';
import { MobileCaptureRecorder } from './mobile-capture-recorder';
import type { DeviceSession, FinalizeInput, FinalizeResult, MintSessionInput, TapToPaySessionPort, TapToPayLookup } from './tap-to-pay-session';

const T = '00000000-0000-4000-8000-0000000000a1';
const B1 = '00000000-0000-4000-8000-0000000000b1';
const B2 = '00000000-0000-4000-8000-0000000000b2';

/** a minimal Kysely-shaped reader over two in-memory tables (selectFrom → select → where… → executeTakeFirst) */
function fakeDb(tables: Record<string, any[]>) {
  return {
    selectFrom(table: string) {
      const filters: [string, unknown][] = [];
      const q: any = {
        select: () => q, selectAll: () => q,
        where: (col: string, _op: string, v: unknown) => { filters.push([col, v]); return q; },
        executeTakeFirst: async () => (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)),
        execute: async () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v)),
      };
      return q;
    },
  } as any;
}
const secrets = { encrypt: (s: string) => s, decrypt: (s: string) => s } as any;
const PROD = { NODE_ENV: 'production', COMMERCEHUB_TTP_MERCHANT_ID: 'PLATFORM-MID' } as any;
const SANDBOX = { NODE_ENV: 'test', COMMERCEHUB_TTP_MERCHANT_ID: 'PLATFORM-MID', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 'TP' } as any;

describe('resolveTapToPayMerchant — which MID a location charges through', () => {
  const db = fakeDb({
    payment_merchant_accounts: [
      { id: 'acct-1', tenant_id: T, branch_id: B1, status: 'active', tap_to_pay_merchant_id: 'MID-B1', tap_to_pay_terminal_id: 'TERM-B1' },
      { id: 'acct-2', tenant_id: T, branch_id: B2, status: 'active', tap_to_pay_merchant_id: null, tap_to_pay_terminal_id: null },
    ],
    tenant_payment_config: [{ tenant_id: T, status: 'active', tap_to_pay_merchant_id: 'MID-SALON', tap_to_pay_terminal_id: null }],
  });
  const r = new PaymentGatewayResolver(db, secrets);

  it('a location with its own Tap to Pay MID uses it', async () => {
    const m = await r.resolveTapToPayMerchant(T, B1, PROD);
    expect(m).toMatchObject({ merchantId: 'MID-B1', terminalId: 'TERM-B1', scope: 'branch', merchantAccountId: 'acct-1' });
    expect(m!.merchantIdMasked).not.toContain('MID-B1');
  });
  it('a location whose own merchant row has no Tap to Pay MID is refused — never the salon default', async () => {
    expect(await r.resolveTapToPayMerchant(T, B2, PROD)).toBeNull();
  });
  it('a location without its own merchant row uses the salon default MID', async () => {
    expect(await r.resolveTapToPayMerchant(T, '00000000-0000-4000-8000-0000000000b3', PROD)).toMatchObject({ merchantId: 'MID-SALON', scope: 'tenant' });
  });
  it('an inactive merchant is refused', async () => {
    const r2 = new PaymentGatewayResolver(fakeDb({ tenant_payment_config: [{ tenant_id: T, status: 'paused', tap_to_pay_merchant_id: 'MID-SALON' }] }), secrets);
    expect(await r2.resolveTapToPayMerchant(T, null, SANDBOX)).toBeNull();
  });
  it('no MID of the salon\'s own: production refuses (never the platform MID); a sandbox may use the env MID', async () => {
    const r3 = new PaymentGatewayResolver(fakeDb({ tenant_payment_config: [{ tenant_id: T, status: 'active', tap_to_pay_merchant_id: null }] }), secrets);
    expect(await r3.resolveTapToPayMerchant(T, null, PROD)).toBeNull();
    expect(await r3.resolveTapToPayMerchant(T, null, SANDBOX)).toMatchObject({ merchantId: 'PLATFORM-MID', scope: 'env' });
    expect(await r3.resolveTapToPayMerchant(T, null, { ...PROD, PAYMENTS_ALLOW_ENV_FALLBACK: '1' })).toMatchObject({ scope: 'env' });
  });
  it('another salon\'s MID is never returned', async () => {
    expect(await r.resolveTapToPayMerchant('00000000-0000-4000-8000-0000000000ff', B1, PROD)).toBeNull();
  });
  it('a failed read is an error, never "not configured"', async () => {
    const broken = { selectFrom: () => { const q: any = { select: () => q, where: () => q, executeTakeFirst: () => Promise.reject(new Error('db down')) }; return q; } } as any;
    await expect(new PaymentGatewayResolver(broken, secrets).resolveTapToPayMerchant(T, B1, PROD)).rejects.toThrow(/could not be read/);
  });
});

describe('the CommerceHub adapter sends the LOCATION\'s merchant id', () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  afterEach(() => { process.env = { ...saved }; (globalThis as any).fetch = realFetch; });

  it('mintDeviceSession puts the passed merchant id (not the env one) in merchantDetails', async () => {
    Object.assign(process.env, { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'PLATFORM-MID', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 'TP', COMMERCEHUB_BASE_URL: 'https://cert.api.fiservapps.com/ch' });
    const bodies: any[] = [];
    (globalThis as any).fetch = async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-1', accessToken: 'at', accessTokenTimeToLive: 600 }) }; };
    const a = new FiservCommerceHubTtpAdapter();
    const s = await a.mintDeviceSession({ tenantId: T, branchId: B1, idempotencyKey: 'k1', amountCents: 4500, currency: 'USD', merchant: { merchantId: 'MID-B1', terminalId: 'TERM-B1' } });
    expect(s.sessionToken).toBe('sess-1');
    expect(bodies[0].merchantDetails).toEqual({ merchantId: 'MID-B1', terminalId: 'TERM-B1' });
  });

  it('the platform env MID is no longer required for Tap to Pay to count as configured', async () => {
    Object.assign(process.env, { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 'TP', COMMERCEHUB_BASE_URL: 'https://cert.api.fiservapps.com/ch' });
    delete process.env.COMMERCEHUB_TTP_MERCHANT_ID;
    const bodies: any[] = [];
    (globalThis as any).fetch = async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ sessionId: 'sess-2' }) }; };
    const a = new FiservCommerceHubTtpAdapter();
    expect(a.isConfigured()).toBe(true);
    await a.mintDeviceSession({ tenantId: T, idempotencyKey: 'k2', amountCents: 100, currency: 'USD', merchant: { merchantId: 'MID-SALON' } });
    expect(bodies[0].merchantDetails.merchantId).toBe('MID-SALON');
  });
});

describe('the checkout passes the location\'s merchant to every Tap to Pay call, and refuses a location with none', () => {
  const TTP_ENV = { COMMERCEHUB_TTP_API_KEY: 'k', COMMERCEHUB_TTP_API_SECRET: 's', COMMERCEHUB_TTP_MERCHANT_ID: 'm', COMMERCEHUB_TTP_TERMINAL_PROFILE_ID: 't' };
  const TK = 'tk_2042'; const DEVICE = 'iphone-01'; const TEN = 'luxe001'; const BR = 'br_cherryhill';
  const perms = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.cash_payment', 'mobile_checkout.split_payment', 'pos.devices.manage'];
  const ctx = (over: any = {}): any => ({ tenantId: TEN, branchId: BR, userId: 'u_owner', role: 'OWNER', permissions: perms, ...over });
  class Spy implements TapToPaySessionPort {
    readonly provider = 'fiserv_commercehub'; seen: any[] = [];
    isConfigured() { return true; }
    async mintDeviceSession(i: MintSessionInput): Promise<DeviceSession> { this.seen.push(['mint', i.merchant]); return { provider: this.provider, sessionToken: 'sess', expiresAt: new Date(Date.now() + 60_000).toISOString(), environment: 'sandbox' }; }
    async finalizeTransaction(i: FinalizeInput): Promise<FinalizeResult> { this.seen.push(['finalize', i.merchant]); return { verified: true, outcome: 'approved', processorRef: 'TXN', capturedAmountCents: i.amountCents }; }
    async lookupTransaction(i: any): Promise<TapToPayLookup> { this.seen.push(['lookup', i.merchant]); return { kind: 'not_found' }; }
  }
  async function world(mid: { merchantId: string; terminalId: string | null } | null) {
    for (const k of Object.keys(TTP_ENV)) process.env[k] = (TTP_ENV as any)[k];
    const repo = new InMemoryCheckoutRepository();
    const realtime: any = { toTenant: vi.fn(), toTechnician: vi.fn(), toTicket: vi.fn(), toCustomerDisplay: vi.fn(), toOwner: vi.fn(), toPlatform: vi.fn() };
    const checkout = new CheckoutService(repo, undefined, undefined, undefined, undefined, realtime);
    const devices = new InMemoryMobilePayDeviceStore(); const spy = new Spy();
    const asked: any[] = [];
    const gateways: any = { resolve: async () => ({ status: 'active', configured: true, merchantAccountId: null }), resolveTapToPayMerchant: async (t: string, b: string) => { asked.push([t, b]); return mid; } };
    const locks: any = { getStatus: async () => ({ locked: true, ownedByCaller: true, heldBy: null }), acquire: async () => ({ acquired: true, action: 'acquired', expiresAt: '' }), release: async () => ({ released: true }), active: async () => null };
    const svc = new MobileCheckoutService({} as any, gateways, checkout, locks, new InMemoryMobilePaymentAttemptRepository(), new InMemoryTtpOnboardingStore(), devices, spy, undefined, { recorder: new MobileCaptureRecorder(repo, null), realtime, audit: { record: vi.fn() } });
    await svc.setTapToPayOnboarding(ctx({ role: 'SUPER_ADMIN' }), TEN, { appleEntitlementStatus: 'approved', commerceHubStatus: 'active' });
    await svc.registerDevice(ctx(), { deviceId: DEVICE, platform: 'ios', tapToPayCapable: true });
    await svc.setMyDeviceStatus(ctx(), DEVICE, 'active');
    return { svc, spy, asked };
  }
  it('mint and finalize carry the merchant resolved for THIS tenant + location', async () => {
    const { svc, spy, asked } = await world({ merchantId: 'MID-CH', terminalId: 'TERM-CH' });
    await svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K1', deviceId: DEVICE });
    await svc.runReadinessStep(ctx(), 'K1', DEVICE);
    await svc.mintDeviceSession(ctx(), 'K1', DEVICE);
    await svc.applyCaptureResult(ctx(), 'K1', { outcome: 'approved', processorRef: 'sess', brand: 'visa', last4: '4242' }, DEVICE);
    expect(spy.seen).toEqual([['mint', { merchantId: 'MID-CH', terminalId: 'TERM-CH' }], ['finalize', { merchantId: 'MID-CH', terminalId: 'TERM-CH' }]]);
    expect(asked.every(([t, b]) => t === TEN && b === BR)).toBe(true);
  });
  it('a location with no Tap to Pay merchant is refused MERCHANT_NOT_CONFIGURED before an intent exists — the processor is never called', async () => {
    const { svc, spy } = await world(null);
    await expect(svc.createAttempt(ctx(), TK, { sessionId: 's1', idempotencyKey: 'K2', deviceId: DEVICE })).rejects.toMatchObject({ code: 'MERCHANT_NOT_CONFIGURED' });
    expect(spy.seen).toEqual([]);
  });
});
