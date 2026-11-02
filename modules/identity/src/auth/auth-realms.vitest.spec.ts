// auth-realms.vitest.spec.ts — Constitution 3 §1–6 (Step 1, Oct 3 2026): one cookie per realm, iss/typ/actorType in the
// signed token, and a token presented to another realm's route is refused even though it verifies on its own.
import { describe, it, expect } from 'vitest';
import { signSession, verifySession, SESSION_ISSUER, actorTypeFor } from './auth-session-token';
import { readSessionToken, sessionFromRequest, realmForPath, cookieNameFor, REALM_COOKIE, ALL_REALM_COOKIES } from './session-from-request';
import { logoutResponse, selectBranchResponse } from './auth.http';

const SECRET = 'realm-test-secret-realm-test-secret-0123456789';
const NOW = Math.floor(Date.parse('2026-10-03T20:00:00Z') / 1000);
const mint = (role: string, extra: any = {}) => signSession({ userId: 'u1', tenantId: role === 'SUPER_ADMIN' ? null : 't1', branchId: null, role, permissions: [], ...extra } as any, { secret: SECRET, now: NOW });
const req = (cookie: string, path: string) => ({ headers: { cookie }, originalUrl: path });

describe('realms — the token', () => {
  it('signs issuer, type and actor type from the role; a wrong value is refused', () => {
    const t = mint('OWNER'); const v = verifySession(t, { secret: SECRET, now: NOW + 1 });
    expect(v.valid && v.payload.iss).toBe(SESSION_ISSUER);
    expect(v.valid && v.payload.typ).toBe('session');
    expect(v.valid && v.payload.actorType).toBe('TENANT_USER');
    expect(actorTypeFor('SUPER_ADMIN')).toBe('PLATFORM_USER'); expect(actorTypeFor('CUSTOMER')).toBe('CUSTOMER');
    // forge a token whose actorType disagrees with its role (signed with the real secret): it must not verify
    const [p] = t.split('.'); const body = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); body.actorType = 'PLATFORM_USER';
    const { createHmac } = require('node:crypto'); const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fp = b64(body); const sig = createHmac('sha256', SECRET).update(fp).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifySession(`${fp}.${sig}`, { secret: SECRET, now: NOW + 1 }).valid).toBe(false);
  });
  it("a valid customer token is refused on a platform or tenant route, and a staff token on a customer route ('wrong_realm')", () => {
    const customer = mint('CUSTOMER'), staff = mint('MANAGER'), platform = mint('SUPER_ADMIN');
    expect(verifySession(customer, { secret: SECRET, now: NOW + 1, expectedRealm: 'customer' }).valid).toBe(true);
    expect(verifySession(customer, { secret: SECRET, now: NOW + 1, expectedRealm: 'platform' })).toMatchObject({ valid: false, reason: 'wrong_realm' });
    expect(verifySession(customer, { secret: SECRET, now: NOW + 1, expectedRealm: 'tenant' })).toMatchObject({ valid: false, reason: 'wrong_realm' });
    expect(verifySession(staff, { secret: SECRET, now: NOW + 1, expectedRealm: 'customer' })).toMatchObject({ valid: false, reason: 'wrong_realm' });
    expect(verifySession(platform, { secret: SECRET, now: NOW + 1, expectedRealm: 'tenant' })).toMatchObject({ valid: false, reason: 'wrong_realm' });
    expect(verifySession(platform, { secret: SECRET, now: NOW + 1, expectedRealm: 'platform' }).valid).toBe(true);
  });
  it('a legacy token (no iss/typ/actorType, minted before realms) still verifies — nobody is signed out by the deploy', () => {
    const legacyBody = { userId: 'u1', tenantId: 't1', branchId: null, role: 'OWNER', permissions: [], iat: NOW - 100, exp: NOW + 600, aud: 'tenant' };
    const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const { createHmac } = require('node:crypto');
    const p = b64(legacyBody); const sig = createHmac('sha256', SECRET).update(p).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(verifySession(`${p}.${sig}`, { secret: SECRET, now: NOW, expectedRealm: 'tenant' }).valid).toBe(true);
  });
});

describe('realms — the request', () => {
  it('paths map to realms; the /api/v1 alias too', () => {
    expect(realmForPath('/super-admin/tenants')).toBe('platform'); expect(realmForPath('/api/v1/platform/x')).toBe('platform');
    expect(realmForPath('/customer/me')).toBe('customer'); expect(realmForPath('/customers/123')).toBe('tenant');
    expect(realmForPath('/pos/booking/state')).toBe('tenant'); expect(realmForPath('/owner/dashboard')).toBe('tenant'); expect(realmForPath(undefined)).toBe('tenant');
  });
  it('each realm has its own cookie; a route reads only its realm’s cookie', () => {
    expect(cookieNameFor('SUPER_ADMIN')).toBe('aps_platform'); expect(cookieNameFor('CUSTOMER')).toBe('aps_customer'); expect(cookieNameFor('FRONT_DESK')).toBe('aps_session');
    const jar = `aps_session=STAFF; aps_platform=PLAT; aps_customer=CUST`;
    expect(readSessionToken({ cookie: jar }, '/pos/booking')).toBe('STAFF');
    expect(readSessionToken({ cookie: jar }, '/super-admin/tenants')).toBe('PLAT');
    expect(readSessionToken({ cookie: jar }, '/customer/me')).toBe('CUST');
    expect(readSessionToken({ cookie: 'aps_platform=PLAT' }, '/pos/booking')).toBeNull();   // a platform cookie never serves a tenant route
  });
  it('a customer cookie on a staff route yields no session; the same token on its own route does', () => {
    const customer = mint('CUSTOMER');
    expect(sessionFromRequest(req(`aps_customer=${customer}`, '/customer/me'), SECRET, NOW + 1)?.role).toBe('CUSTOMER');
    expect(sessionFromRequest(req(`aps_session=${customer}`, '/pos/booking/state'), SECRET, NOW + 1)).toBeNull();
    expect(sessionFromRequest(req(`aps_customer=${customer}`, '/pos/booking/state'), SECRET, NOW + 1)).toBeNull();
  });
  it('until a browser signs in again, a platform token still in the old aps_session cookie works on platform routes only', () => {
    const platform = mint('SUPER_ADMIN');
    expect(sessionFromRequest(req(`aps_session=${platform}`, '/super-admin/tenants'), SECRET, NOW + 1)?.role).toBe('SUPER_ADMIN');
    expect(sessionFromRequest(req(`aps_session=${platform}`, '/pos/booking/state'), SECRET, NOW + 1)).toBeNull();
  });
  it('login sets the realm’s cookie; logout clears every realm’s cookie', () => {
    const r = selectBranchResponse({ userId: 'u', tenantId: null, branchId: null, role: 'SUPER_ADMIN', permissions: [] } as any, { secret: SECRET, now: NOW } as any);
    expect(r.cookie?.name).toBe('aps_platform');
    const out = logoutResponse();
    // every realm's session cookie AND its refresh cookie (Step 2)
    expect(out.clearCookies?.map((c) => c.name).sort()).toEqual([...ALL_REALM_COOKIES, ...ALL_REALM_COOKIES.map((n) => n + '_refresh')].sort());
    expect(Object.keys(REALM_COOKIE)).toEqual(['tenant', 'platform', 'customer']);
  });
  it('the shared /auth routes serve every realm: a fresh platform session (aps_platform only) still answers /auth/me', () => {
    const platform = mint('SUPER_ADMIN'), customer = mint('CUSTOMER');
    expect(realmForPath('/auth/me')).toBe('any'); expect(realmForPath('/auth/mfa/verify')).toBe('any'); expect(realmForPath('/auth/logout')).toBe('any');
    expect(sessionFromRequest(req(`aps_platform=${platform}`, '/auth/me'), SECRET, NOW + 1)?.role).toBe('SUPER_ADMIN');
    expect(sessionFromRequest(req(`aps_customer=${customer}`, '/auth/me'), SECRET, NOW + 1)?.role).toBe('CUSTOMER');
    expect(sessionFromRequest(req(`aps_session=${customer}`, '/auth/me'), SECRET, NOW + 1)?.role).toBe('CUSTOMER');   // the old cookie until re-sign-in
  });
  it('expired platform cookie does not block a valid tenant cookie on shared routes', () => {
    const staff = mint('OWNER');
    const jar = `aps_platform=garbage_or_expired_platform_token; aps_session=${staff}`;
    const s = sessionFromRequest(req(jar, '/auth/branches'), SECRET, NOW + 1);
    expect(s?.role).toBe('OWNER');
    expect(s?.userId).toBe('u1');
  });
  it('/push is a shared route (manifest realm=shared): a customer browser registers its push token with its own cookie', () => {
    const cust = mint('CUSTOMER');
    expect(sessionFromRequest(req(`aps_customer=${cust}`, '/push/register'), SECRET, NOW + 1)?.role).toBe('CUSTOMER');
  });
});
