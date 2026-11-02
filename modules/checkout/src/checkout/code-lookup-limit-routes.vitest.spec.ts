// code-lookup-limit-routes.vitest.spec.ts — BUILD_PLAN Phase 14 (Constitution 12): every POS route that looks a gift
// card / coupon / reward code up BY ITS CODE carries @CodeLookupLimited, and what each route answers for an UNKNOWN
// code (the real controller over the real service, in-memory repository) is classified as a MISS — so a reworded error
// message cannot quietly make wrong guesses free. Then the interceptor end to end: 12 wrong guesses, the 13th is 429 with
// Retry-After; another cashier is unaffected.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { lastValueFrom, from } from 'rxjs';
import { CODE_LOOKUP_KIND, CodeLookupLimitInterceptor } from '@aipowersalon/security/nest';
import { CODE_LOOKUP_BUDGET, InMemoryCodeLookupStore, classifyLookupError, classifyLookupResult } from '@aipowersalon/security';
import { DealRefusedError } from '@aipowersalon/deals';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { InMemoryCheckoutRepository } from './checkout.repository';

const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.gift_card_issue', 'pos.checkout.gift_card_payment', 'pos.checkout.redeem_reward', 'pos.deals.apply', 'pos.checkout.split_payment'];
const req = (userId = 'u_owner') => ({ ctx: { tenantId: 'luxe001', branchId: 'br_cherryhill', userId, role: 'OWNER', permissions: PERMS }, ip: '203.0.113.9' });
const TK = 'tk_2042';
const UNKNOWN = '9999888877776666';

const CODE_ROUTES: Record<string, string> = {
  giftLookup: 'gift_card', giftBalance: 'gift_card', voidGift: 'gift_card', giftReplace: 'gift_card',
  payGift: 'gift_card', paySplit: 'gift_card', giftReload: 'gift_card', applyRewardCode: 'reward_code', applyPromotion: 'coupon', applyOffer: 'coupon',
};

async function outcome(fn: () => Promise<unknown>) {
  try { return classifyLookupResult(await fn()); } catch (e) { return classifyLookupError(e); }
}

describe('every lookup-by-code POS route is limited', () => {
  it('carries @CodeLookupLimited with the right kind', () => {
    for (const [m, kind] of Object.entries(CODE_ROUTES)) expect(Reflect.getMetadata(CODE_LOOKUP_KIND, (CheckoutController.prototype as any)[m]), m).toBe(kind);
  });
  it('a route that takes no code is not limited (a sale, a cash payment)', () => {
    expect(Reflect.getMetadata(CODE_LOOKUP_KIND, (CheckoutController.prototype as any).giftSale)).toBeUndefined();
    expect(Reflect.getMetadata(CODE_LOOKUP_KIND, (CheckoutController.prototype as any).payCash)).toBeUndefined();
  });
});

describe('an unknown code is a MISS on every route (real controller + service)', () => {
  const repo = new InMemoryCheckoutRepository();
  const c = new CheckoutController(new CheckoutService(repo));
  const due = async () => (await repo.totalsFor(req().ctx as any, TK, 'split'))!.totalDueCents;
  const cases: [string, () => Promise<unknown>][] = [
    ['giftLookup', () => c.giftLookup(req(), { input: UNKNOWN })],
    ['giftBalance', () => c.giftBalance(req(), UNKNOWN)],
    ['voidGift', () => c.voidGift(req(), UNKNOWN)],
    ['giftReplace', () => c.giftReplace(req(), { input: UNKNOWN })],
    ['payGift', () => c.payGift(req(), TK, { giftCardCode: UNKNOWN })],
    ['paySplit', async () => { const d = await due(); return c.paySplit(req(), TK, { segments: [{ method: 'gift_card', amountCents: 100, giftCardCode: UNKNOWN }, { method: 'cash', amountCents: d - 100 }] }); }],
    ['giftReload', () => c.giftReload(req(), TK, { code: UNKNOWN, amountCents: 500 })],
    ['applyRewardCode', () => c.applyRewardCode(req(), TK, { code: 'RWD-NOPE-0000' })],
  ];
  for (const [name, call] of cases) it(name, async () => { expect(await outcome(call)).toBe('miss'); });

  it('coupon routes: the deals engine refusal for an unknown code, through the controller mapping', async () => {
    const svc: any = { applyOffer: async () => { throw new DealRefusedError('That code isn’t valid here.', 400, [{ code: 'unknown_code', message: 'Unknown code.' }]); } };
    svc.applyPromotion = svc.applyOffer;
    const cc = new CheckoutController(svc);
    expect(await outcome(() => cc.applyOffer(req(), TK, { code: 'NOPE1234' }))).toBe('miss');
    expect(await outcome(() => cc.applyPromotion(req(), TK, { code: 'NOPE1234' }))).toBe('miss');
  });
});

describe('the interceptor end to end over the real controller', () => {
  const c = new CheckoutController(new CheckoutService(new InMemoryCheckoutRepository()));
  const store = new InMemoryCodeLookupStore(() => Date.UTC(2026, 0, 15, 10));
  const ic = new CodeLookupLimitInterceptor(store);
  const call = async (r: any) => {
    const headers: Record<string, string> = {};
    const ctx: any = { getHandler: () => (CheckoutController.prototype as any).giftLookup, switchToHttp: () => ({ getRequest: () => r, getResponse: () => ({ header: (k: string, v: string) => { headers[k] = v; } }) }) };
    try { return { body: await lastValueFrom(ic.intercept(ctx, { handle: () => from(c.giftLookup(r, { input: UNKNOWN })) })), headers }; }
    catch (e: any) { return { status: e?.getStatus?.(), body: e?.getResponse?.(), headers }; }
  };
  it('12 wrong guesses answer {found:false}; the 13th is 429 with Retry-After; another cashier still works', async () => {
    for (let i = 0; i < CODE_LOOKUP_BUDGET.caller; i++) {
      const r = await call(req('u_guesser'));
      expect(r.body).toEqual({ found: false });
      await new Promise((ok) => setImmediate(ok));   // settle() runs after the response
    }
    const refused = await call(req('u_guesser'));
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ code: 'CODE_LOOKUP_LIMITED' });
    expect(Number(refused.headers['Retry-After'])).toBeGreaterThan(0);
    expect((await call(req('u_other'))).body).toEqual({ found: false });
  });
});

// BUILD_PLAN Phase 14 integration (lead): the limiter counts lookups BY SECRET CODE. Applying a LISTED deal by its id, or a
// split payment with no gift-card leg, names no code — it must never be admitted, counted or refused (the Phase 5 live
// load proof: 120 registers applying one capped deal at once got 3 through, the rest 429, before this).
describe('a request that carries no code is not counted', () => {
  const store = new InMemoryCodeLookupStore(() => Date.UTC(2026, 0, 15, 10));
  const ic = new CodeLookupLimitInterceptor(store);
  const through = async (handler: string, body: any) => {
    const r: any = { ...req('u_busy_desk'), body };
    const ctx: any = { getHandler: () => (CheckoutController.prototype as any)[handler], switchToHttp: () => ({ getRequest: () => r, getResponse: () => ({ header: () => undefined }) }) };
    try { await lastValueFrom(ic.intercept(ctx, { handle: () => from(Promise.resolve({ ok: true })) })); return 200; }
    catch (e: any) { return e?.getStatus?.() ?? 500; }
  };
  it('applying a deal by id, 3× the caller budget at once — every one passes', async () => {
    const n = CODE_LOOKUP_BUDGET.caller * 3;
    const res = await Promise.all(Array.from({ length: n }, () => through('applyOffer', { dealId: 'd_1' })));
    expect(res.filter((s) => s === 429)).toEqual([]);
  });
  it('a split payment with no gift-card leg passes; one WITH a gift-card code is still counted', async () => {
    const n = CODE_LOOKUP_BUDGET.caller * 3;
    const res = await Promise.all(Array.from({ length: n }, () => through('paySplit', { segments: [{ method: 'cash', amountCents: 100 }, { method: 'card', amountCents: 100 }] })));
    expect(res.filter((s) => s === 429)).toEqual([]);
    const coded = await Promise.all(Array.from({ length: n }, () => through('paySplit', { segments: [{ method: 'gift_card', amountCents: 100, giftCardCode: UNKNOWN }] })));
    expect(coded.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
  it('an offer WITH a code is still counted', async () => {
    const n = CODE_LOOKUP_BUDGET.caller * 3;
    const res = await Promise.all(Array.from({ length: n }, () => through('applyOffer', { code: 'NOPE1234' })));
    expect(res.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
