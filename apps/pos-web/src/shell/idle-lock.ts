// idle-lock.ts — Functional Decision 35: auto-lock a trusted salon device after inactivity; quick unlock with the
// employee's 4-digit PIN; full sign-in again after LONG inactivity.
//
// Before Oct 1: the timer was 1 minute under a "5 minutes" comment, the settings text said 1 minute, auto-lock was OFF
// unless someone had switched it on, and a lock never expired — a screen locked on Friday night quick-unlocked on Monday.
// Oct 12 2026 (Kevin): "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after 8
// hours locked." The SERVER now locks the session itself after the SALON's minutes (Security → Sign-in policy, default 60) —
// this file is the device's local timer for instant UX: it never runs longer than the salon's value (a device may still choose
// a SHORTER time, Decision 35), and a device cannot switch the salon's lock off. The PIN check is server-side
// (/auth/verify-pin); the 8 hours are the server's (it ends the session), mirrored here.
import { AUTO_LOCK_DEFAULT, DEVICE_AUTO_LOCK_MINUTE_CHOICES, LOCKED_FULL_SIGN_IN_HOURS, SALON_AUTO_LOCK_MINUTE_CHOICES, effectiveDeviceLock, type AutoLockPolicy } from '@aipowersalon/api-contracts';

export const IDLE_LOCK_MINUTE_CHOICES = DEVICE_AUTO_LOCK_MINUTE_CHOICES;
export const DEFAULT_IDLE_LOCK_MINUTES = AUTO_LOCK_DEFAULT.minutes;
/** Locked longer than this → quick PIN is no longer enough; full sign-in (the decision's "long inactivity threshold"). */
export const LONG_INACTIVITY_HOURS = LOCKED_FULL_SIGN_IN_HOURS;

const K = { enabled: 'auto_lock_enabled', minutes: 'auto_lock_minutes', locked: 'pos_locked', lockedAt: 'pos_locked_at', salon: 'auto_lock_salon' };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export interface IdleLockSettings { enabled: boolean; minutes: number }
/** The DEVICE's own choice: enabled unless this device explicitly turned it off ('false'); minutes from the allowed choices,
 *  default 60. What actually runs is effectiveIdleLock() — never longer than the salon's value. */
export function readIdleLockSettings(s: Store): IdleLockSettings {
  const enabled = safe(() => s.getItem(K.enabled), null) !== 'false';
  const m = Number(safe(() => s.getItem(K.minutes), null));
  const minutes = (IDLE_LOCK_MINUTE_CHOICES as readonly number[]).includes(m) ? m : DEFAULT_IDLE_LOCK_MINUTES;
  return { enabled, minutes };
}
export function writeIdleLockSettings(s: Store, next: Partial<IdleLockSettings>): IdleLockSettings {
  const cur = readIdleLockSettings(s);
  const enabled = next.enabled ?? cur.enabled;
  const minutes = next.minutes !== undefined && (IDLE_LOCK_MINUTE_CHOICES as readonly number[]).includes(next.minutes) ? next.minutes : cur.minutes;
  safe(() => { s.setItem(K.enabled, enabled ? 'true' : 'false'); s.setItem(K.minutes, String(minutes)); }, undefined);
  return { enabled, minutes };
}

export function markLocked(s: Store, nowMs: number): void { safe(() => { s.setItem(K.locked, 'true'); s.setItem(K.lockedAt, String(nowMs)); }, undefined); }
export function clearLock(s: Store): void { safe(() => { s.removeItem(K.locked); s.removeItem(K.lockedAt); }, undefined); }

export type LockState = 'unlocked' | 'quick_pin' | 'full_sign_in';
/** A lock with no recorded time (written before this change) is treated as long expired: full sign-in. */
export function lockState(s: Store, nowMs: number): LockState {
  if (safe(() => s.getItem(K.locked), null) !== 'true') return 'unlocked';
  const at = Number(safe(() => s.getItem(K.lockedAt), null));
  if (!Number.isFinite(at) || at <= 0) return 'full_sign_in';
  return nowMs - at > LONG_INACTIVITY_HOURS * 3_600_000 ? 'full_sign_in' : 'quick_pin';
}

/** The salon's value as the server last told this device (GET /auth/lock-status), so the timer is right before the network
 *  answers. Unknown → the platform default (on, 60). */
export function readSalonLock(s: Store): AutoLockPolicy {
  try {
    const v = JSON.parse(safe(() => s.getItem(K.salon), null) ?? 'null');
    if (v && typeof v.enabled === 'boolean' && (SALON_AUTO_LOCK_MINUTE_CHOICES as readonly number[]).includes(v.minutes)) return { enabled: v.enabled, minutes: v.minutes };
  } catch { /* fall through */ }
  return { ...AUTO_LOCK_DEFAULT };
}
export function writeSalonLock(s: Store, p: AutoLockPolicy): void { safe(() => s.setItem(K.salon, JSON.stringify({ enabled: p.enabled, minutes: p.minutes })), undefined); }
/** What this device's timer runs: the device's choice, capped by the salon's (and on whenever the salon's lock is on). */
export function effectiveIdleLock(s: Store): IdleLockSettings { return effectiveDeviceLock(readIdleLockSettings(s), readSalonLock(s)); }
