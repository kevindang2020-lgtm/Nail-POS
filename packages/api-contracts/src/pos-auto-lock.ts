// pos-auto-lock.ts — Functional Decision 35 as Kevin set it on Oct 12 2026: "POS auto-lock is on by default at 60 minutes,
// also locked on the server, with a full sign-in after 8 hours locked."
// The ONE copy of the rules, shared by the API (the session lock in the tenant-context middleware + the session store), the
// salon settings validation and the POS (its local timer for instant UX). Browser-safe, dependency-free.
//
// What is a POS device session: a session signed in by the POS web app, which sends `X-Client-Type: pos` on its requests —
// the value is stored on the session row at sign-in (sessions.client_app, migration 570). Only those sessions are idle-locked
// by the server. The four mobile apps (tech / owner / customer / manager-pay), the native sign-in, the kiosk and the customer
// display (device tokens, not sessions), owner-web / admin-web / tech-web and scripts send something else or nothing.
// The header is not a credential: a client that omits it only avoids the idle clock of a session it already fully owns.
//
// Decision 35 is kept where Kevin's rule does not override it: quick unlock with the employee's 4-digit PIN (server-checked),
// a device may choose a SHORTER time than the salon (the salon's minutes are the maximum), a lock older than 8 hours needs a
// full sign-in (the server revokes the session).

/** X-Client-Type value of the POS web app. */
export const POS_CLIENT_TYPE = 'pos' as const;
/** Kevin, Oct 12 2026: on by default, 60 minutes. */
export const AUTO_LOCK_DEFAULT: Readonly<AutoLockPolicy> = Object.freeze({ enabled: true, minutes: 60 });
/** What the owner may choose for the salon (the maximum idle time of any POS device). */
export const SALON_AUTO_LOCK_MINUTE_CHOICES = [5, 10, 15, 30, 60, 120] as const;
/** What a device may choose for itself (Decision 35) — used only when shorter than the salon's value. */
export const DEVICE_AUTO_LOCK_MINUTE_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120] as const;
/** Locked longer than this → the session ends (full sign-in). Decision 35's "long inactivity threshold". */
export const LOCKED_FULL_SIGN_IN_HOURS = 8;
export const SESSION_LOCK_MAX_MS = LOCKED_FULL_SIGN_IN_HOURS * 3_600_000;
/** The 5th wrong PIN on a session ends it (full sign-in) — enforced on the session row, so it holds without Redis. */
export const PIN_UNLOCK_MAX_FAILURES = 5;
/** The POS reports a person's activity at most this often (POST /auth/session-activity). */
export const ACTIVITY_REPORT_INTERVAL_MS = 60_000;

export interface AutoLockPolicy { enabled: boolean; minutes: number }

/** The salon's stored `security` settings → its auto-lock policy. Missing / invalid → the default (on, 60). */
export function autoLockPolicyFrom(stored: unknown): AutoLockPolicy {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const enabled = typeof s.autoLockEnabled === 'boolean' ? s.autoLockEnabled : AUTO_LOCK_DEFAULT.enabled;
  const m = s.autoLockMinutes;
  const minutes = typeof m === 'number' && (SALON_AUTO_LOCK_MINUTE_CHOICES as readonly number[]).includes(m) ? m : AUTO_LOCK_DEFAULT.minutes;
  return { enabled, minutes };
}

/** 'pos' when the request says it comes from the POS web app, else null (exact match only). */
export function posClientType(headers: Record<string, unknown> | undefined | null): typeof POS_CLIENT_TYPE | null {
  const raw = headers ? (headers['x-client-type'] ?? headers['X-Client-Type']) : undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === POS_CLIENT_TYPE ? POS_CLIENT_TYPE : null;
}

/** What the server knows about a session (times in ms). */
export interface SessionLockFacts { clientApp: string | null; tenantId: string | null; lastActivityAt: number | null; lockedAt: number | null }

/** When the session became locked, or null. An explicit lock (the device locked itself, POST /auth/lock) always counts; an idle
 *  lock applies to a salon's POS session only, at last activity + the salon's minutes — so the 8 hours run from when the
 *  device went idle, not from the next request (a screen left on Friday night needs a full sign-in on Monday). */
export function serverLockedAt(f: SessionLockFacts, policy: AutoLockPolicy, nowMs: number): number | null {
  if (f.lockedAt) return f.lockedAt;
  if (f.clientApp !== POS_CLIENT_TYPE || !f.tenantId || !f.lastActivityAt || !policy.enabled) return null;
  const at = f.lastActivityAt + policy.minutes * 60_000;
  return nowMs >= at ? at : null;
}

export type SessionLockStateName = 'unlocked' | 'locked' | 'expired';
export function sessionLockState(f: SessionLockFacts, policy: AutoLockPolicy, nowMs: number): { state: SessionLockStateName; lockedAt: number | null } {
  const lockedAt = serverLockedAt(f, policy, nowMs);
  if (!lockedAt) return { state: 'unlocked', lockedAt: null };
  return { state: nowMs - lockedAt > SESSION_LOCK_MAX_MS ? 'expired' : 'locked', lockedAt };
}

/** The device's own timer: never longer than the salon's (and always on while the salon's lock is on). */
export function effectiveDeviceLock(device: AutoLockPolicy, salon: AutoLockPolicy): AutoLockPolicy {
  if (!salon.enabled) return { enabled: device.enabled, minutes: device.minutes };
  return { enabled: true, minutes: device.enabled ? Math.min(device.minutes, salon.minutes) : salon.minutes };
}

/** GET /auth/lock-status — readable by a locked session (it is on the locked-session allowlist). */
export interface SessionLockStatus {
  /** this session is a POS device session (idle-locked by the server) */
  posSession: boolean;
  /** the salon's policy (the maximum for every POS device) */
  salon: AutoLockPolicy;
  locked: boolean;
  lockedAt: string | null;
  /** when quick PIN stops working and the session ends (lockedAt + 8 h) */
  fullSignInAt: string | null;
  /** when the server will lock this session if nobody uses it (POS sessions, unlocked) */
  idleLockAt: string | null;
  fullSignInAfterHours: number;
}

/** POST /auth/session-activity — when the server will lock this session if nobody uses it (null: not a POS session / off). */
export interface SessionActivityResponse { ok: true; idleLockAt: string | null }
