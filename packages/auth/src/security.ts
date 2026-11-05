/**
 * security.ts — pure security helpers (no I/O). Each is unit-tested.
 *   - normalizeIdentifier: email/phone normalization + type detection
 *   - checkPasswordPolicy:  strength rules (min 10, classes)
 *   - mfaRequiredForRole:   role/tenant MFA policy + code shape
 *   - rateLimitDecision:    failed-attempt lockout (sliding window)
 *   - refreshTokenDecision: rotation vs. reuse-detection
 *   - buildTenantContext:   derive trusted context; never trust client tenantId
 */
import type { Role } from '@aipowersalon/permissions';

/* ----------------------------- identifier ----------------------------- */
export type IdentifierKind = 'email' | 'phone' | 'unknown';
export interface NormalizedIdentifier { kind: IdentifierKind; value: string; }

export function normalizeIdentifier(raw: string, defaultCountry = '1'): NormalizedIdentifier {
  const s = (raw || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { kind: 'email', value: s.toLowerCase() };
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length >= 7 && digits.length <= 15) {
    const e164 = digits.length === 10 ? `+${defaultCountry}${digits}` : `+${digits}`;
    return { kind: 'phone', value: e164 };
  }
  return { kind: 'unknown', value: s };
}

/* --------------------------- password policy --------------------------- */
export interface PasswordResult { ok: boolean; errors: string[]; }
export function checkPasswordPolicy(pw: string): PasswordResult {
  const errors: string[] = [];
  if (!pw || pw.length < 10) errors.push('Use at least 10 characters.');
  if (!/[a-z]/.test(pw)) errors.push('Add a lowercase letter.');
  if (!/[A-Z]/.test(pw)) errors.push('Add an uppercase letter.');
  if (!/\d/.test(pw)) errors.push('Add a number.');
  if (/^\s|\s$/.test(pw)) errors.push('Remove leading/trailing spaces.');
  return { ok: errors.length === 0, errors };
}

/* ------------------------------ mfa policy ----------------------------- */
export type MfaPolicy = 'required' | 'optional';
const ROLE_MFA: Record<Role, MfaPolicy> = {
  SUPER_ADMIN: 'required', OWNER: 'optional', MANAGER: 'optional',
  FRONT_DESK: 'optional', RECEPTION: 'optional', TECHNICIAN: 'optional', CUSTOMER: 'optional',
};
/** SUPER_ADMIN is always required. Tenant roles can be forced on by a tenant/user setting. */
export function mfaRequiredForRole(role: Role, opts: { userMfaEnabled?: boolean; tenantForce?: boolean } = {}): boolean {
  if (ROLE_MFA[role] === 'required') return true;
  return !!opts.userMfaEnabled || !!opts.tenantForce;
}
export function isValidMfaCode(code: string): boolean {
  return /^\d{6}$/.test((code || '').trim());
}
/**
 * Whether the any-6-digit fallback is DISABLED (real enrolled TOTP required for any MFA-gated user).
 * On by default in production; opt in elsewhere with MFA_REQUIRE_TOTP=1. Local/dev stays permissive so testing
 * doesn't require an authenticator app. When this is true and a user has no confirmed TOTP factor, MFA cannot be
 * satisfied by a bare 6-digit code — the user must enroll (see scripts/enroll-mfa.ts for the operator bootstrap).
 */
export function requireRealTotpEnrollment(): boolean {
  return process.env.MFA_REQUIRE_TOTP === '1' || process.env.NODE_ENV === 'production';
}

/* ------------------------------ rate limit ----------------------------- */
export interface RateLimitState { failuresInWindow: number; lockedUntil?: number; }
export interface RateLimitDecision { allowed: boolean; lockMs: number; remaining: number; }
/**
 * Sliding lockout. After `maxFailures` within the window, lock for `lockMs`.
 * `now` and timestamps are epoch ms so the function stays pure/testable.
 */
export function rateLimitDecision(
  failureTimestamps: number[], now: number,
  opts: { windowMs?: number; maxFailures?: number; lockMs?: number } = {},
): RateLimitDecision {
  const windowMs = opts.windowMs ?? 15 * 60_000;
  const maxFailures = opts.maxFailures ?? 5;
  const lockMs = opts.lockMs ?? 15 * 60_000;
  const recent = failureTimestamps.filter((t) => now - t < windowMs);
  if (recent.length >= maxFailures) {
    const oldest = Math.min(...recent);
    const until = oldest + lockMs;
    if (until > now) return { allowed: false, lockMs: until - now, remaining: 0 };
  }
  return { allowed: true, lockMs: 0, remaining: Math.max(0, maxFailures - recent.length) };
}

/* --------------------------- refresh tokens ---------------------------- */
export type RefreshOutcome = 'ROTATE' | 'REUSE_DETECTED' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
export interface StoredRefreshToken { revokedAt?: number | null; expiresAt: number; supersededByTokenId?: string | null; }
/**
 * Decide what to do when a refresh token is presented.
 * - supersededByTokenId set  => token was already rotated => REUSE_DETECTED (revoke chain).
 * - revokedAt set            => REVOKED.
 * - expired                  => EXPIRED. else ROTATE.
 */
export function refreshTokenDecision(stored: StoredRefreshToken | null, now: number): RefreshOutcome {
  if (!stored) return 'UNKNOWN';
  if (stored.supersededByTokenId) return 'REUSE_DETECTED';
  if (stored.revokedAt) return 'REVOKED';
  if (stored.expiresAt <= now) return 'EXPIRED';
  return 'ROTATE';
}

/* --------------------------- tenant context ---------------------------- */
export interface VerifiedTokenPayload { tenantId: string; branchId: string; userId: string; role: Role; permissions: string[]; subscriptionStatus: string; }
export interface TenantContext { tenantId: string; branchId: string; userId: string; role: Role; permissions: string[]; subscriptionStatus: string; }
/**
 * Build trusted tenant context from the *verified token only*. Any tenantId in
 * the request body/query is ignored. For SUPER_ADMIN, an explicit tenant filter
 * is allowed (super-admin routes operate cross-tenant).
 */
export function buildTenantContext(payload: VerifiedTokenPayload): TenantContext {
  return {
    tenantId: payload.tenantId, branchId: payload.branchId, userId: payload.userId,
    role: payload.role, permissions: payload.permissions, subscriptionStatus: payload.subscriptionStatus,
  };
}
/** Returns true if a normal (non-super-admin) request tried to smuggle a tenantId. */
export function isCrossTenantAttempt(ctx: TenantContext, requestedTenantId?: string | null): boolean {
  if (!requestedTenantId) return false;
  if (ctx.role === 'SUPER_ADMIN') return false;
  return requestedTenantId !== ctx.tenantId;
}

/* ------------------------------ session lifetime ------------------------------ */
/**
 * Constitution 12 §23/§152 (audit finding M4). How long a session lives, decided on the server by ROLE.
 *
 * Every role used to get the same lifetime — 12 hours, or 30 DAYS with "Remember me" — including SUPER_ADMIN, the
 * highest-risk account on the platform. Now: SUPER_ADMIN is capped (default 8 h, AUTH_SESSION_TTL_SUPER_ADMIN may
 * shorten it but never lengthen it past 12 h) and "Remember me" does NOT extend it. Everyone else keeps today's
 * behaviour exactly. The session row and the cookie both read this one function, so they can never disagree.
 */
export const SUPER_ADMIN_TTL_CEILING_S = 12 * 60 * 60;
export function sessionTtlSeconds(role: Role | string | undefined, rememberMe: boolean, env: Record<string, string | undefined> = process.env): number {
  const normal = Number(env.AUTH_SESSION_TTL) || 12 * 60 * 60;
  const remember = Number(env.AUTH_SESSION_TTL_REMEMBER) || 30 * 24 * 60 * 60;
  if (role === 'SUPER_ADMIN') {
    const configured = Number(env.AUTH_SESSION_TTL_SUPER_ADMIN) || 8 * 60 * 60;
    return Math.min(Math.max(configured, 5 * 60), SUPER_ADMIN_TTL_CEILING_S);   // floor 5 min, ceiling 12 h — no remember-me
  }
  return rememberMe ? remember : normal;
}

/*
 * NOTE (Constitution 12, correcting the Phase 1 audit): refreshTokenDecision above is NOT WIRED. AI PowerSalon uses
 * server-side revocable sessions — the cookie carries a session id checked against the session store on every
 * request — and issues no bearer refresh tokens, so §24 rotation/reuse-detection has nothing to act on. Revocation
 * (§25) is what covers that threat here, and it works. Kept, clearly labelled, for the day a refresh-token flow exists.
 */
