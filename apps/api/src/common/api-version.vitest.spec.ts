// api-version.vitest.spec.ts — Constitution 5 §11–13: /api/v1 is an alias of every route; legacy paths carry deprecation
// headers, except the URLs that live in third-party configs.
import { describe, it, expect } from 'vitest';
import { rewriteApiV1, legacyDeprecationHeaders, apiVersionMiddleware, legacyPathHits, DEFAULT_LEGACY_SUNSET, legacyPrefixOf } from './api-version';

describe('/api/v1 alias', () => {
  it('maps onto today’s paths (query kept); leaves the platform alias and non-v1 paths alone', () => {
    expect(rewriteApiV1('/api/v1/pos/booking/state?date=2026-10-04')).toBe('/pos/booking/state?date=2026-10-04');
    expect(rewriteApiV1('/api/v1/auth/login')).toBe('/auth/login');
    expect(rewriteApiV1('/api/v1')).toBe('/'); expect(rewriteApiV1('/api/v1?x=1')).toBe('/?x=1');
    expect(rewriteApiV1('/api/v1/platform/tenants')).toBeNull();
    expect(rewriteApiV1('/api/ai-booking/v1/slots')).toBeNull(); expect(rewriteApiV1('/api/v10/x')).toBeNull(); expect(rewriteApiV1('/pos/x')).toBeNull();
  });
  it('legacy paths: Deprecation + Link to the v1 successor + Sunset (90 days from the Phase 12 move unless a date is set)', () => {
    expect(DEFAULT_LEGACY_SUNSET).toBe('2027-01-06');   // Oct 8 2026 + 90 days — the apps moved to /api/v1 that day
    expect(legacyDeprecationHeaders('/pos/booking/state?d=1', {})).toEqual({ Deprecation: 'true', Link: '</api/v1/pos/booking/state>; rel="successor-version"', Sunset: 'Wed, 06 Jan 2027 00:00:00 GMT' });
    expect(legacyDeprecationHeaders('/pos/x', { API_LEGACY_SUNSET: '2027-06-30' } as any)?.Sunset).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
    expect(legacyDeprecationHeaders('/pos/x', { API_LEGACY_SUNSET: 'off' } as any)?.Sunset).toBeUndefined();
    expect(legacyDeprecationHeaders('/pos/x', { API_LEGACY_SUNSET: 'someday' } as any)?.Sunset).toBe('Wed, 06 Jan 2027 00:00:00 GMT');
  });
  it('never on the cookie-scoped refresh or the one /platform route (/api/v1/platform/* is the Super Admin alias)', () => {
    expect(legacyDeprecationHeaders('/auth/refresh', {})).toBeNull();
    expect(legacyDeprecationHeaders('/platform/branding', {})).toBeNull();
    expect(legacyDeprecationHeaders('/auth/login', {})?.Deprecation).toBe('true');
  });
  it('counts legacy-path hits by first segment (bounded labels), never v1 or exempt requests', () => {
    const before = (p: string) => (legacyPathHits.snapshot().find((s: any) => s.labels.prefix === p)?.value as number) ?? 0;
    const noop = { setHeader: () => {} };
    const pos0 = before('pos'), other0 = before('other'), v10 = before('auth');
    apiVersionMiddleware({ url: '/pos/x?y=1' }, noop, () => {});
    apiVersionMiddleware({ url: '/pos/y' }, noop, () => {});
    apiVersionMiddleware({ url: '/api/v1/auth/me' }, noop, () => {});
    apiVersionMiddleware({ url: '/health/ready' }, noop, () => {});
    apiVersionMiddleware({ url: '/x' + 'z'.repeat(40) }, noop, () => {});
    expect(before('pos') - pos0).toBe(2); expect(before('auth') - v10).toBe(0); expect(before('other') - other0).toBe(1);
    expect(legacyPrefixOf('/super-admin/tenants?x')).toBe('super-admin'); expect(legacyPrefixOf('/not-an-api-prefix/x')).toBe('other');
  });
  it('never on probes, metrics, webhooks, inbound integrations, media, OAuth endpoints or the versioned voice APIs', () => {
    for (const p of ['/health/ready', '/readyz', '/metrics', '/webhooks/twilio', '/webhook/stripe', '/integrations/inbound/abc', '/media/x.png', '/oauth/token', '/api/ai-booking/v1/slots', '/.well-known/x'])
      expect(legacyDeprecationHeaders(p, {})).toBeNull();
  });
  it('the middleware rewrites url AND originalUrl for v1, and stamps headers only on legacy requests', () => {
    const headers: Record<string, string> = {}; const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
    const v1: any = { url: '/api/v1/pos/x', originalUrl: '/api/v1/pos/x' }; apiVersionMiddleware(v1, res, () => {});
    expect([v1.url, v1.originalUrl, v1.apiVersion]).toEqual(['/pos/x', '/pos/x', 'v1']); expect(headers).toEqual({});
    const legacy: any = { url: '/pos/x', originalUrl: '/pos/x' }; apiVersionMiddleware(legacy, res, () => {});
    expect(headers.Deprecation).toBe('true');
    const plat: any = { url: '/super-admin/x', platformAlias: true }; const h2: Record<string, string> = {};
    apiVersionMiddleware(plat, { setHeader: (k: string, v: string) => { h2[k] = v; } }, () => {}); expect(h2).toEqual({});
  });
});
