// Fiserv master build §5 / §14 acceptance — pure eligibility gates + provider surcharge parsing.
import { describe, it, expect } from 'vitest';
import { classifyProviderHost, hostMatchesEnvironment, processModeProblem, productionEligibility } from './payment-eligibility';
import { CardPointeClient, decimalStringToCents, type FetchLike } from './cardpointe.client';

describe('provider host allowlist (§5.3)', () => {
  it.each([
    ['gateway', 'https://isv-uat.cardconnect.com/cardconnect/rest', 'uat'],
    ['gateway', 'https://fts-uat.cardconnect.com', 'uat'],
    ['gateway', 'https://fts.cardconnect.com', 'production'],
    ['bolt', 'https://bolt-uat.cardpointe.com/api', 'uat'],
    ['bolt', 'https://mysite.bolt.cardpointe.com', 'production'],
    ['clover', 'https://scl-sandbox.dev.clover.com', 'uat'],
    ['clover', 'https://scl.clover.com', 'production'],
  ] as const)('%s %s → %s', (kind, url, env) => { expect(classifyProviderHost(kind, url)).toEqual({ ok: true, environment: env }); });

  it.each([
    ['gateway', 'http://isv-uat.cardconnect.com', 'HOST_NOT_HTTPS'],
    ['gateway', 'https://cardconnect.com.evil.net', 'HOST_NOT_ALLOWLISTED'],
    ['gateway', 'https://evil.com/fts.cardconnect.com', 'HOST_NOT_ALLOWLISTED'],
    ['gateway', 'https://user:pw@fts.cardconnect.com', 'HOST_HAS_CREDENTIALS'],
    ['gateway', 'https://fts.cardconnect.com:8443', 'HOST_PORT_NOT_ALLOWED'],
    ['bolt', 'https://bolt.cardpointe.com.attacker.io', 'HOST_NOT_ALLOWLISTED'],
    ['clover', 'https://clover.com', 'HOST_NOT_ALLOWLISTED'],
    ['gateway', 'not a url', 'HOST_INVALID'],
    ['gateway', '', 'HOST_MISSING'],
  ] as const)('%s %s refused (%s)', (kind, url, reason) => { expect(classifyProviderHost(kind, url)).toMatchObject({ ok: false, reason }); });

  it('UAT host on a production merchant row is refused, and vice versa', () => {
    expect(hostMatchesEnvironment('gateway', 'https://isv-uat.cardconnect.com', 'production')).toMatchObject({ ok: false, reason: 'UAT_HOST_ON_PRODUCTION_MERCHANT' });
    expect(hostMatchesEnvironment('bolt', 'https://mysite.bolt.cardpointe.com', 'sandbox')).toMatchObject({ ok: false, reason: 'PRODUCTION_HOST_ON_SANDBOX_MERCHANT' });
    expect(hostMatchesEnvironment('bolt', 'https://bolt-uat.cardpointe.com/api', 'sandbox').ok).toBe(true);
  });
});

describe('deployment mode (§8F)', () => {
  it('default deployment is UAT-only: production rows refused, sandbox rows allowed', () => {
    expect(processModeProblem('production', {} as any)).toBe('PRODUCTION_DISABLED_IN_THIS_DEPLOYMENT');
    expect(processModeProblem('sandbox', {} as any)).toBeNull();
  });
  it('a live deployment refuses sandbox rows', () => {
    expect(processModeProblem('sandbox', { PAYMENTS_LIVE_MODE: '1' } as any)).toBe('SANDBOX_MERCHANT_IN_LIVE_DEPLOYMENT');
    expect(processModeProblem('production', { PAYMENTS_LIVE_MODE: '1' } as any)).toBeNull();
  });
});

describe('production eligibility (§5.1) — Super Admin "active" alone never enables live charging', () => {
  const ok = { status: 'approved', fiservReference: 'FISV-123', validatedAt: '2026-12-01' };
  const m = { environment: 'production', onboardingStatus: 'approved', credentialsVerifiedAt: '2026-12-02', productionEnabledAt: '2026-12-03' };
  it('all gates met → allowed', () => { expect(productionEligibility(ok, true, m)).toEqual({ ok: true }); });
  it('sandbox rows are not judged by the production gate', () => { expect(productionEligibility(null, false, { ...m, environment: 'sandbox' }).ok).toBe(true); });
  it.each([
    [null, true, m, 'PLATFORM_NOT_VALIDATED_BY_FISERV'],
    [{ ...ok, status: 'submitted' }, true, m, 'PLATFORM_NOT_VALIDATED_BY_FISERV'],
    [{ ...ok, fiservReference: null }, true, m, 'PLATFORM_NOT_VALIDATED_BY_FISERV'],
    [ok, false, m, 'PLATFORM_PRODUCTION_DISABLED'],
    [ok, true, { ...m, onboardingStatus: 'under_review' }, 'MERCHANT_NOT_BOARDED'],
    [ok, true, { ...m, credentialsVerifiedAt: null }, 'MERCHANT_CREDENTIALS_NOT_VERIFIED'],
    [ok, true, { ...m, productionEnabledAt: null }, 'MERCHANT_PRODUCTION_NOT_ENABLED'],
  ] as const)('missing gate → %#', (p, en, mm, reason) => { expect(productionEligibility(p as any, en, mm as any)).toEqual({ ok: false, reason }); });
});

describe('provider-assessed surcharge parsing (§9.3)', () => {
  const mk = (body: any): FetchLike => async () => ({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) });
  const c = (body: any) => new CardPointeClient({ baseUrl: 'https://isv-uat.cardconnect.com', merchid: 'm', username: 'u', password: 'p' }, mk(body));
  it('fee_amount / fee_type / fee_value become surchargeCents / feeType / feeValue', async () => {
    const r = await c({ respstat: 'A', retref: 'R', amount: '103.00', fee_amount: '3.00', fee_type: 'SURCHRG', fee_value: '300' }).authorizeAndCapture({ account: '9', amountCents: 10000 });
    expect(r).toMatchObject({ approved: true, amountCents: 10300, surchargeCents: 300, feeType: 'SURCHRG', feeValue: '300' });
  });
  it('a waived surcharge records 0', async () => {
    const r = await c({ respstat: 'A', retref: 'R', amount: '100.00', fee_amount: '3.00', fee_type: 'SURCHRG_WAIVED' }).authorizeAndCapture({ account: '9', amountCents: 10000 });
    expect(r.surchargeCents).toBe(0);
  });
  it('no fee fields → no surcharge reported', async () => {
    const r = await c({ respstat: 'A', retref: 'R', amount: '100.00' }).authorizeAndCapture({ account: '9', amountCents: 10000 });
    expect(r.surchargeCents).toBeUndefined();
  });
  it('strict decimal parsing never guesses', () => {
    expect(decimalStringToCents('3.00')).toBe(300); expect(decimalStringToCents('12')).toBe(1200); expect(decimalStringToCents('0.5')).toBe(50);
    expect(decimalStringToCents('3.005')).toBeUndefined(); expect(decimalStringToCents('-3.00')).toBeUndefined(); expect(decimalStringToCents('abc')).toBeUndefined();
  });
});
