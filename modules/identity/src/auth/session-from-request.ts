/**
 * session-from-request.ts — extract + verify the session from an incoming request (Nest-free, so it stays testable and
 * is safe for the tenant-context middleware to call). Accepts a token from an `Authorization: Bearer <token>` header or
 * from the cookie of the REALM the request's path belongs to. Returns the verified SessionPayload or null (never throws).
 */
import { verifySession, audienceFor, type SessionPayload, type SessionRealm } from './auth-session-token';
/** 'any' = a route every realm uses with its own session (/auth/* — me, logout, MFA, step-up, password reset, WebAuthn —
 *  and client telemetry). These read whichever realm cookie is present and verify without a realm expectation. */
export type RouteRealm = SessionRealm | 'any';
/** The tenant realm's cookie — the name every app has always used. */
export const SESSION_COOKIE = 'aps_session';
/** Constitution 3 §1–6 (Oct 3 2026): ONE COOKIE PER REALM. A platform (Super Admin) session and a customer session no
 *  longer sit in the same cookie slot of the same browser as a salon-staff session; each realm's routes read only its
 *  own cookie, and logout clears all of them. */
export const REALM_COOKIE: Record<SessionRealm, string> = { tenant: 'aps_session', platform: 'aps_platform', customer: 'aps_customer' };
export const ALL_REALM_COOKIES: string[] = Object.values(REALM_COOKIE);
export function cookieNameFor(role: string): string { return REALM_COOKIE[audienceFor(role)]; }
/** Which realm a route belongs to, by its path. Platform: /super-admin and /platform (and their /api/v1 aliases);
 *  customer: /customer; everything else is the tenant realm (POS, owner, technician, kiosks, public booking today). */
export function realmForPath(path: string | undefined): RouteRealm {
  const p = String(path ?? '').replace(/^\/api\/v1(?=\/)/, '').split('?')[0];
  if (/^\/(auth|client-telemetry|public\/mfa-recovery|push)(\/|$)/.test(p)) return 'any';
  // BUILD_PLAN Phase 13 (Constitution 6 §28–32): every realm's native app asks for its own stream ticket here; the ticket
  // records the realm and is redeemed only on that realm's stream.
  if (p === '/realtime/stream-ticket') return 'any';
  if (/^\/(super-admin|platform)(\/|$)/.test(p)) return 'platform';
  if (/^\/customer(\/|$)/.test(p)) return 'customer';
  return 'tenant';
}
function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const v = part.slice(eq + 1).trim();
      try { return decodeURIComponent(v) || null; } catch { return v || null; }
    }
  }
  return null;
}
/** The token for this request: a Bearer header (native apps) first, else the cookie of the realm the PATH belongs to.
 *  Until a browser signs in again after the Oct 3 deploy its platform/customer token still sits in `aps_session`, so that
 *  cookie is the fallback for those realms — the verifier's expectedRealm still refuses a token from the wrong realm. */
export function readSessionToken(headers: Record<string, any> | undefined, path?: string): string | null {
  const h = headers || {};
  const auth = h.authorization || h.Authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, '').trim();
    return t || null;
  }
  const cookie = h.cookie;
  if (typeof cookie !== 'string') return null;
  const realm = realmForPath(path);
  if (realm === 'any') {
    const origin = String(h.origin || h.referer || '');
    const isTenantApp = /:808[23467]/.test(origin) || /branches|select-branch/.test(path || '');
    if (isTenantApp) {
      return cookieValue(cookie, SESSION_COOKIE) ?? cookieValue(cookie, REALM_COOKIE.platform) ?? cookieValue(cookie, REALM_COOKIE.customer);
    }
    return cookieValue(cookie, REALM_COOKIE.platform) ?? cookieValue(cookie, REALM_COOKIE.customer) ?? cookieValue(cookie, SESSION_COOKIE);
  }
  return cookieValue(cookie, REALM_COOKIE[realm]) ?? (realm === 'tenant' ? null : cookieValue(cookie, SESSION_COOKIE));
}
export function sessionFromRequest(req: { headers?: Record<string, any>; originalUrl?: string; url?: string; path?: string }, secret: string, now?: number): SessionPayload | null {
  const path = req?.originalUrl ?? req?.url ?? req?.path;
  const h = req?.headers || {};
  const auth = h.authorization || h.Authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    const t = auth.replace(/^Bearer\s+/i, '').trim();
    if (t) {
      const realm = realmForPath(path);
      const r = verifySession(t, { secret, now, expectedRealm: realm === 'any' ? undefined : realm });
      if (r.valid) return r.payload;
    }
  }
  const cookie = h.cookie;
  if (typeof cookie !== 'string') return null;
  const realm = realmForPath(path);
  if (realm === 'any') {
    const origin = String(h.origin || h.referer || '');
    const isTenantApp = /:808[23467]/.test(origin) || /branches|select-branch/.test(path || '');
    const isCustomerApp = origin.includes(':8085') || /customer/.test(origin);
    const candidateNames = isTenantApp
      ? [SESSION_COOKIE, REALM_COOKIE.platform, REALM_COOKIE.customer]
      : isCustomerApp
      ? [REALM_COOKIE.customer, SESSION_COOKIE, REALM_COOKIE.platform]
      : [REALM_COOKIE.platform, REALM_COOKIE.customer, SESSION_COOKIE];

    for (const name of candidateNames) {
      const val = cookieValue(cookie, name);
      if (val) {
        const r = verifySession(val, { secret, now });
        if (r.valid) return r.payload;
      }
    }
    return null;
  }
  const primary = cookieValue(cookie, REALM_COOKIE[realm]);
  if (primary) {
    const r = verifySession(primary, { secret, now, expectedRealm: realm });
    if (r.valid) return r.payload;
  }
  if (realm !== 'tenant') {
    const fallback = cookieValue(cookie, SESSION_COOKIE);
    if (fallback) {
      const r = verifySession(fallback, { secret, now, expectedRealm: realm });
      if (r.valid) return r.payload;
    }
  }
  return null;
}
