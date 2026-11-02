/**
 * auth.http.ts — pure HTTP shaping for the auth controller (Nest-free, fully unit-testable).
 *
 * The thin @Controller (next slice) calls LoginService.attempt, hands the result here, and just applies the returned
 * status / body / cookie to the Express response. Keeping the decision here (which outcomes set the session cookie,
 * what status each maps to, what is safe to echo) means it is testable without bootstrapping Nest or a database.
 */
import { signSession, type SessionClaims } from './auth-session-token';
import { cookieNameFor, ALL_REALM_COOKIES } from './session-from-request';
import type { LoginResult, LoginPrincipal } from './auth-login.service';

export interface CookieDescriptor { name: string; value: string; maxAge: number; httpOnly: boolean; sameSite: 'lax' | 'strict' | 'none'; secure: boolean; path: string; }
export interface HttpResponseSpec { status: number; body: Record<string, unknown>; cookie?: CookieDescriptor; cookies?: CookieDescriptor[]; clearCookies?: { name: string; path: string }[]; clearCookie?: { name: string; path: string }; }

// Authenticated-but-needs-more (MFA / branch selection) returns 200 because the client must collect another input.
// Hard blocks map to 401/403 so the client treats them as failures; an unknown outcome is a 400.
const STATUS: Record<string, number> = {
  SUCCESS: 200, BRANCH_SELECTION_REQUIRED: 200, MFA_REQUIRED: 200,
  INVALID_CREDENTIALS: 401, TENANT_NOT_FOUND: 401,
  TENANT_SUSPENDED: 403, TENANT_CANCELLED: 403, USER_DISABLED: 403, SUBSCRIPTION_BLOCKED: 403,
  BRANCH_INACTIVE: 403,   // account-access refusal, like the other inactive-* outcomes (not a credential error)
  RATE_LIMITED: 429,
};

const DEFAULT_TTL = 60 * 60 * 12; // 12h

function publicPrincipal(p: LoginPrincipal) {
  return {
    userId: p.userId, tenantId: p.tenantId, branchId: p.branchId, role: p.role,
    permissions: p.permissions, subscriptionStatus: p.subscriptionStatus,
    needsBranchSelection: p.needsBranchSelection, fullName: p.fullName,
  };
}
function sessionCookie(token: string, ttlSeconds: number, secure: boolean, role: string): CookieDescriptor {
  return { name: cookieNameFor(role), value: token, maxAge: ttlSeconds * 1000, httpOnly: true, sameSite: 'lax', secure, path: '/' };
}
export const REFRESH_COOKIE_PATH = '/auth/refresh';
export function refreshCookieNameFor(role: string): string { return cookieNameFor(role) + '_refresh'; }
function refreshCookie(token: string, ttlSeconds: number, secure: boolean, role: string): CookieDescriptor {
  return { name: refreshCookieNameFor(role), value: token, maxAge: ttlSeconds * 1000, httpOnly: true, sameSite: 'lax', secure, path: REFRESH_COOKIE_PATH };
}
/** AUTH_ACCESS_TTL seconds (default 15 min). An absent/invalid value falls back to the default — never to "no expiry". */
export function accessTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.AUTH_ACCESS_TTL); return Number.isFinite(n) && n >= 60 && n <= 60 * 60 * 12 ? Math.floor(n) : 15 * 60;
}

export interface LoginResponseOpts {
  secret: string; ttlSeconds?: number; now?: number; secure?: boolean; sid?: string;
  /** Constitution 3 §7–12 (Oct 3 2026): the ACCESS token's own life (AUTH_ACCESS_TTL, default 15 min); the cookie lives
   *  the SESSION's life (ttlSeconds) so the refresh route still sees the expired token (browsers delete expired cookies). */
  accessTtlSeconds?: number;
  /** The opaque refresh token issued for this session (set as `<realm cookie>_refresh` scoped to /auth/refresh; in the
   *  body for native). */
  refreshToken?: string;
  /**
   * Return the session token in the RESPONSE BODY as well as the cookie.
   *
   * ONLY for the native mobile app, which cannot use the cookie at all (inside a Capacitor/WebView shell the
   * origin is `capacitor://localhost`, so a SameSite=Lax cookie is never sent to the API). Native stores this in
   * the Keychain/Keystore and sends it as `Authorization: Bearer`.
   *
   * A BROWSER must never get this. The token staying out of JavaScript is precisely what stops an XSS bug from
   * exfiltrating a long-lived credential — so the caller decides from the unforgeable `Origin` header, never from
   * anything page script can set. Defaults to false: the safe answer.
   */
  includeToken?: boolean;
}

export function loginResponse(result: LoginResult, opts: LoginResponseOpts): HttpResponseSpec {
  const status = STATUS[result.outcome] ?? 400;
  if (result.outcome === 'SUCCESS' && result.principal) {
    const p = result.principal;
    const ttl = opts.ttlSeconds ?? DEFAULT_TTL;
    const claims: SessionClaims = {
      userId: p.userId, tenantId: p.tenantId, branchId: p.branchId,
      role: p.role, permissions: p.permissions, subscriptionStatus: p.subscriptionStatus,
      ...(p.platformRole ? { platformRole: p.platformRole } : {}),   // Constitution 7 §5 (signed)
      ...(p.restriction ? { restriction: p.restriction } : {}),     // Constitution 7 §19 (signed): billing-only session
      ...(opts.sid ? { sid: opts.sid } : {}),      // lets a later revoke actually reject this token
      ...(typeof p.av === 'number' ? { av: p.av, tv: p.tv ?? null } : {}),   // BUILD_PLAN Phase 9: authorization versions (signed)
    };
    const token = signSession(claims, { secret: opts.secret, ttlSeconds: opts.accessTtlSeconds ?? ttl, now: opts.now });
    return {
      status,
      body: {
        ok: true, outcome: 'SUCCESS', principal: publicPrincipal(p),
        // NATIVE ONLY. A browser never sees this — keeping the token out of JavaScript is what stops an XSS bug
        // from exfiltrating a long-lived credential. See native-client.ts.
        ...(opts.includeToken ? { accessToken: token, expiresIn: opts.accessTtlSeconds ?? ttl, ...(opts.refreshToken ? { refreshToken: opts.refreshToken } : {}) } : {}),
      },
      cookie: sessionCookie(token, ttl, !!opts.secure, claims.role),
      ...(opts.refreshToken ? { cookies: [refreshCookie(opts.refreshToken, ttl, !!opts.secure, claims.role)] } : {}),
    };
  }
  if (result.outcome === 'BRANCH_SELECTION_REQUIRED' && result.principal) {
    // Authenticated (credentials + MFA passed) — issue a session WITHOUT a branch; POST /auth/select-branch then
    // validates the chosen branch and re-issues the session with it set.
    const p = result.principal;
    const ttl = opts.ttlSeconds ?? DEFAULT_TTL;
    const claims: SessionClaims = { userId: p.userId, tenantId: p.tenantId, branchId: null, role: p.role, permissions: p.permissions, subscriptionStatus: p.subscriptionStatus, ...(opts.sid ? { sid: opts.sid } : {}), ...(typeof p.av === 'number' ? { av: p.av, tv: p.tv ?? null } : {}) };
    const token = signSession(claims, { secret: opts.secret, ttlSeconds: opts.accessTtlSeconds ?? ttl, now: opts.now });
    return {
      status,
      body: {
        ok: false, outcome: result.outcome, message: result.message, principal: publicPrincipal(p),
        // Native needs the token here too — a multi-branch user must be able to call /auth/select-branch, and
        // they cannot do that with a cookie the native shell will never send.
        ...(opts.includeToken ? { accessToken: token, expiresIn: opts.accessTtlSeconds ?? ttl, ...(opts.refreshToken ? { refreshToken: opts.refreshToken } : {}) } : {}),
      },
      cookie: sessionCookie(token, ttl, !!opts.secure, claims.role),
      ...(opts.refreshToken ? { cookies: [refreshCookie(opts.refreshToken, ttl, !!opts.secure, claims.role)] } : {}),
    };
  }
  return { status, body: { ok: false, outcome: result.outcome, message: result.message, ...(result.maskedPhone ? { maskedPhone: result.maskedPhone } : {}) } };
}

// select-branch success: re-issue the session with the chosen branch set and echo the (now branch-scoped) principal.
export function selectBranchResponse(claims: SessionClaims, opts: LoginResponseOpts): HttpResponseSpec {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL;
  const token = signSession(claims, { secret: opts.secret, ttlSeconds: opts.accessTtlSeconds ?? ttl, now: opts.now });
  return {
    status: 200,
    body: {
      ok: true,
      principal: { userId: claims.userId, tenantId: claims.tenantId, branchId: claims.branchId, role: claims.role, permissions: claims.permissions, subscriptionStatus: claims.subscriptionStatus, needsBranchSelection: false },
      // The session was RE-SIGNED here, so native must be given the new token — otherwise it would keep using the
      // pre-branch one and every later request would be scoped to no branch.
      ...(opts.includeToken ? { accessToken: token, expiresIn: opts.accessTtlSeconds ?? ttl, ...(opts.refreshToken ? { refreshToken: opts.refreshToken } : {}) } : {}),
    },
    cookie: sessionCookie(token, ttl, !!opts.secure, claims.role),
    ...(opts.refreshToken ? { cookies: [refreshCookie(opts.refreshToken, ttl, !!opts.secure, claims.role)] } : {}),
  };
}

export function logoutResponse(): HttpResponseSpec {
  // §1–6: logout clears EVERY realm's cookie — a browser that held a platform and a tenant session leaves with neither.
  return { status: 200, body: { ok: true }, clearCookie: { name: ALL_REALM_COOKIES[0], path: '/' }, clearCookies: [...ALL_REALM_COOKIES.map((name) => ({ name, path: '/' })), ...ALL_REALM_COOKIES.map((name) => ({ name: name + '_refresh', path: REFRESH_COOKIE_PATH }))] };
}
