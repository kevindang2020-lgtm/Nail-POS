/**
 * auth-session-token.ts — stateless session tokens (slice 4), dependency-free (Node crypto HMAC-SHA256).
 *
 * A token is `base64url(payloadJSON).base64url(hmac)`. The payload carries the trusted identity produced by the login
 * orchestrator (LoginPrincipal) plus iat/exp. Verification is constant-time and never throws — a tampered or expired
 * token returns { valid: false }. This is a signed (not encrypted) token: it contains no secrets, only ids/role/perms
 * the server already authorized. The signing secret comes from the caller (the controller reads it from env), so this
 * module stays pure and unit-testable.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { permissionsFor, platformPermissionsFor, type Role } from '@aipowersalon/permissions';

export interface SessionPayload {
  userId: string;
  tenantId: string | null;     // null for SUPER_ADMIN
  branchId: string | null;
  role: Role;
  /** Always present AFTER verifySession. On the wire it is OMITTED whenever it exactly equals the role's defaults
   *  (permissionsFor(role)) and re-derived at verification — the role sits inside the SIGNED payload, so this cannot
   *  be used to escalate. Reason: embedding the full list ballooned the cookie to ~7 KB, past the ~4 KB browser cap,
   *  so Chromium/Edge silently DROPPED the session cookie and no login survived a page reload. Non-default lists
   *  (e.g. TECHNICIAN per-salon overrides from technician_permissions) are still embedded verbatim, and legacy
   *  tokens that carry the full list keep working unchanged. */
  permissions: string[];
  subscriptionStatus: string;
  /** Constitution 7 §5 — which platform role a SUPER_ADMIN session holds (signed, so it cannot be raised client-side).
   *  The permission array is then derived from it like a role default, keeping the cookie small. */
  platformRole?: string;
  /** Constitution 7 §19 — 'SUSPENDED_BILLING_ONLY' limits the session to billing routes (SuspendedAccessGuard). Signed. */
  restriction?: string;
  iat: number;                 // epoch seconds
  exp: number;                 // epoch seconds
  /** Session row id — lets a REVOKED session be rejected. Absent on tokens minted before revocation support,
   *  which are still accepted (no forced sign-out on deploy). */
  sid?: string;
  /** Constitution 7 — the REALM this token was issued for, bound into the signed payload: 'platform' (SUPER_ADMIN),
   *  'customer' (CUSTOMER) or 'tenant' (every salon staff role). Always set by signSession from the signed role — no
   *  caller can choose it — and verifySession rejects a token whose audience does not match its role. */
  aud?: SessionAudience;
  /** Constitution 3 §1–6 (Oct 3 2026): issuer and token type, signed. Legacy tokens carry neither; a token that carries
   *  a WRONG value is refused. */
  iss?: string;
  typ?: 'session';
  /** Who the token is for, derived from the role — a service or integration token is never an employee (§15). */
  actorType?: SessionActorType;
  /** BUILD_PLAN Phase 9: users.authorization_version / tenants.authorization_version when this token's authority was
   *  derived (sign-in, branch selection, refresh). The request path compares them with the current values; a stale
   *  session is re-authorized from the current grants (authorization-state.ts). Absent on older tokens. */
  av?: number;
  tv?: number | null;
}
export type SessionAudience = 'platform' | 'tenant' | 'customer';
/** §1–6: the realm IS the audience — one field, one meaning (no second "realm" claim that could disagree). */
export type SessionRealm = SessionAudience;
export type SessionActorType = 'PLATFORM_USER' | 'TENANT_USER' | 'CUSTOMER';
export const SESSION_ISSUER = 'aipowersalon';
export function actorTypeFor(role: string): SessionActorType {
  return role === 'SUPER_ADMIN' ? 'PLATFORM_USER' : role === 'CUSTOMER' ? 'CUSTOMER' : 'TENANT_USER';
}
export type SessionClaims = Omit<SessionPayload, 'iat' | 'exp' | 'aud' | 'iss' | 'typ' | 'actorType'>;

/** The one mapping from role to token audience. */
export function audienceFor(role: string): SessionAudience {
  return role === 'SUPER_ADMIN' ? 'platform' : role === 'CUSTOMER' ? 'customer' : 'tenant';
}
/** Tokens minted before audiences existed carry no `aud`. They are accepted ONLY if issued before this instant, so
 *  deploying does not sign anyone out and they age out within one session lifetime; a token WITHOUT `aud` minted after
 *  it can only come from a signer that bypassed signSession, and is rejected. (Sep 30 2026 + 1 day of deploy slack.) */
export const AUDIENCE_REQUIRED_FROM_EPOCH = Math.floor(Date.parse('2026-10-02T00:00:00Z') / 1000);

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sign = (payloadB64: string, secret: string) => b64url(createHmac('sha256', secret).update(payloadB64).digest());

export interface SignOpts { secret: string; ttlSeconds?: number; now?: number; }

const samePermissionSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  for (const x of a) if (!set.has(x)) return false;
  return true;
};

/** The permissions a payload carries when it embeds none: the platform role's set for a platform session that names one,
 *  else the role default (a legacy SUPER_ADMIN token with no platformRole keeps the full set it was minted with). */
function defaultPermissionsOf(p: { role: any; platformRole?: string }): string[] {
  return p.role === 'SUPER_ADMIN' && p.platformRole ? platformPermissionsFor(p.platformRole) : permissionsFor(p.role);
}

export function signSession(claims: SessionClaims, opts: SignOpts): string {
  if (!opts.secret) throw new Error('session secret required');
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const body: SessionPayload = { ...(claims as SessionPayload), iat: now, exp: now + (opts.ttlSeconds ?? 60 * 60 * 12), aud: audienceFor(claims.role), iss: SESSION_ISSUER, typ: 'session', actorType: actorTypeFor(claims.role) };   // aud from the signed role, never from the caller
  // Keep the cookie under the browsers' ~4 KB ceiling: drop the permissions array when it is exactly the role
  // default (the common case for every role) — verifySession re-derives it from the signed role. Anything else
  // (tech overrides, deliberately-empty lists from reset flows) is embedded verbatim.
  if (Array.isArray(body.permissions) && samePermissionSet(body.permissions, defaultPermissionsOf(body))) {
    delete (body as Partial<SessionPayload>).permissions;
  }
  const p = b64url(JSON.stringify(body));
  return `${p}.${sign(p, opts.secret)}`;
}

export type VerifyResult = { valid: true; payload: SessionPayload } | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'bad_audience' | 'wrong_realm' };

/** opts.expectedRealm (§1–6): the realm the ROUTE belongs to — a valid token presented to another realm's route is
 *  refused with 'wrong_realm' even though it would verify on its own realm. */
export function verifySession(token: string, opts: { secret: string; now?: number; expectedRealm?: SessionRealm; /** the refresh route only: an EXPIRED (never a forged) access token still names the session to renew */ allowExpired?: boolean }): VerifyResult {
  try {
    if (typeof token !== 'string' || !opts.secret) return { valid: false, reason: 'malformed' };
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return { valid: false, reason: 'malformed' };
    const p = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectSig = sign(p, opts.secret);
    const a = Buffer.from(sig), b = Buffer.from(expectSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'bad_signature' };
    let payload: SessionPayload;
    try { payload = JSON.parse(fromB64url(p).toString('utf8')) as SessionPayload; }
    catch { return { valid: false, reason: 'malformed' }; }   // hardening (Jul 29 sweep): a verifier reports, it never throws
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || (payload.exp <= now && !opts.allowExpired)) return { valid: false, reason: 'expired' };
    // Constitution 7 platform token audience: the token's realm must be the realm of its role. A legacy token (no aud)
    // is accepted only if it was issued before audiences became mandatory — see AUDIENCE_REQUIRED_FROM_EPOCH.
    if (payload.aud === undefined) {
      if (typeof payload.iat !== 'number' || payload.iat >= AUDIENCE_REQUIRED_FROM_EPOCH) return { valid: false, reason: 'bad_audience' };
    } else if (payload.aud !== audienceFor(payload.role)) {
      return { valid: false, reason: 'bad_audience' };
    }
    // §1–6: a wrong issuer or token type is refused; absence is legacy (minted before Oct 3 2026) and accepted.
    if (payload.iss !== undefined && payload.iss !== SESSION_ISSUER) return { valid: false, reason: 'malformed' };
    if (payload.typ !== undefined && payload.typ !== 'session') return { valid: false, reason: 'malformed' };
    if (payload.actorType !== undefined && payload.actorType !== actorTypeFor(payload.role)) return { valid: false, reason: 'malformed' };
    const realm = payload.aud ?? audienceFor(payload.role);
    if (opts.expectedRealm && realm !== opts.expectedRealm) return { valid: false, reason: 'wrong_realm' };
    if (!Array.isArray(payload.permissions)) payload.permissions = defaultPermissionsOf(payload);
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'malformed' };
  }
}
