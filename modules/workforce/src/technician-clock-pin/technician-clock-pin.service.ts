// technician-clock-pin.service.ts — the secure primitive the Go Check-In clock flow builds on: set and verify a
// technician's 4-digit Clock PIN. The PIN is hashed with the same vetted hasher used for passwords/owner access codes,
// never stored or logged in plaintext. Verification is rate-limited (see clock-pin-core) so a 4-digit space can't be
// brute-forced. Everything is tenant-scoped via ctx.
//
// This slice deliberately exposes NO HTTP surface. It is the domain primitive; the identify-by-PIN lookup, the
// clock-in/out wiring to the existing time-clock service, the kiosk UI, and the manager reset endpoint build on top of
// it in later slices.
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { isValidPinFormat, isWeakPin, isLocked, registerFailure, clearFailures, type PinRateState } from './clock-pin-core';

export interface ClockPinContext { tenantId: string; branchId?: string | null; }

export interface ClockPinRow { pinHash: string; failedAttempts: number; lockedUntil: string | null; }

/** A technician (active account + membership) at the device's branch who has a Clock PIN set. */
export interface PinnedTechnician { technicianId: string; pinHash: string; failedAttempts: number; lockedUntil: string | null; }

export interface ClockPinRepository {
  getPin(ctx: ClockPinContext, technicianId: string): Promise<ClockPinRow | null>;
  upsertPin(ctx: ClockPinContext, technicianId: string, pinHash: string, actorId: string | null): Promise<void>;
  updateRateState(ctx: ClockPinContext, technicianId: string, state: PinRateState): Promise<void>;
  /** Active technicians at this tenant/branch who have a Clock PIN — the only candidates an identify scan considers. */
  listActivePinnedTechnicians(ctx: ClockPinContext): Promise<PinnedTechnician[]>;
}

export class ClockPinValidationError extends Error {}
export class ClockPinLockedError extends Error {
  constructor(public readonly lockedUntil: string) { super('This PIN is temporarily locked after too many attempts. Try again later or ask a manager to reset it.'); }
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'no_pin' | 'mismatch' };

/**
 * Result of identifying a technician purely from an entered PIN (the Go Check-In flow, where no id is typed).
 * 'duplicate_match' means two active technicians at this branch share the PIN — the caller must disambiguate with a
 * second factor rather than guess. No technician list is ever returned.
 */
export type IdentifyResult =
  | { outcome: 'identified'; technicianId: string }
  | { outcome: 'no_match' }
  | { outcome: 'duplicate_match' }
  | { outcome: 'invalid_format' };

/**
 * Per-kiosk failure limiter for identify-by-PIN (workforce audit P0 #6/#8). The per-technician lockout in
 * clock-pin-core only protects a PIN that already matched someone; an attacker at the kiosk enumerating the 4-digit
 * space against EVERY technician was never counted. The limiter counts failed identifications per (tenant, kiosk)
 * and refuses once the window is full. `hit` THROWS on a store error and identify then FAILS CLOSED.
 */
export interface KioskPinLimiter {
  /** In-window FAILURES for (scope, key) and when the oldest happened. */
  count(scope: string, key: string, windowMs: number): Promise<{ count: number; oldestMs: number | null }>;
  /** Record one failure. */
  record(scope: string, key: string): Promise<void>;
}
export const KIOSK_PIN_FAIL_SCOPE = 'kiosk_pin_fail';
export const KIOSK_PIN_FAIL_LIMIT = 10;
export const KIOSK_PIN_FAIL_WINDOW_MS = 10 * 60_000;

export class KioskPinLockedError extends Error {
  constructor(public readonly retryAfterMs: number) { super('Too many PIN attempts on this device. Please wait a few minutes or ask a manager.'); }
}

export class TechnicianClockPinService {
  constructor(private readonly repo: ClockPinRepository, private readonly kioskLimiter?: KioskPinLimiter) {}

  /** Set or reset a technician's Clock PIN. `actorId` is the manager who did it, or null for self/onboarding. */
  async setPin(ctx: ClockPinContext, technicianId: string, pin: string, actorId: string | null): Promise<void> {
    if (!technicianId) throw new ClockPinValidationError('technicianId is required');
    if (!isValidPinFormat(pin)) throw new ClockPinValidationError('The Clock PIN must be exactly 4 digits.');
    if (isWeakPin(pin)) throw new ClockPinValidationError('Please choose a less predictable PIN.');
    const pinHash = await hashPassword(pin);
    await this.repo.upsertPin(ctx, technicianId, pinHash, actorId);
  }

  /**
   * Verify an entered PIN for a specific technician. Rate-limited: a locked PIN throws (no hash comparison happens),
   * a wrong PIN advances the lockout counter, a correct PIN clears it. Never reveals whether a PIN exists via timing
   * differences beyond the unavoidable — callers should surface only a generic failure to the device.
   */
  async verifyPin(ctx: ClockPinContext, technicianId: string, pin: string, nowIso = new Date().toISOString()): Promise<VerifyResult> {
    const row = await this.repo.getPin(ctx, technicianId);
    if (!row) return { ok: false, reason: 'no_pin' };
    if (isLocked(row, nowIso)) throw new ClockPinLockedError(row.lockedUntil as string);
    if (!isValidPinFormat(pin)) {
      await this.persist(ctx, technicianId, registerFailure(row, nowIso));
      return { ok: false, reason: 'mismatch' };
    }
    const matches = await verifyPassword(pin, row.pinHash).catch(() => false);
    if (matches) {
      if (row.failedAttempts !== 0 || row.lockedUntil) await this.persist(ctx, technicianId, clearFailures());
      return { ok: true };
    }
    await this.persist(ctx, technicianId, registerFailure(row, nowIso));
    return { ok: false, reason: 'mismatch' };
  }

  private persist(ctx: ClockPinContext, technicianId: string, state: PinRateState) {
    return this.repo.updateRateState(ctx, technicianId, state);
  }

  /**
   * Identify a technician from a PIN alone, scanning only active pinned technicians at the device's tenant/branch.
   * Locked candidates are skipped. Every candidate is checked (no short-circuit) so a PIN shared by two technicians is
   * reported as 'duplicate_match' rather than silently resolving to whichever came first. On a unique match the
   * technician's failure counter is cleared. Nothing here reveals who else exists.
   */
  async identifyByPin(ctx: ClockPinContext, pin: string, nowIso = new Date().toISOString(), kioskKey?: string | null): Promise<IdentifyResult> {
    if (!isValidPinFormat(pin)) return { outcome: 'invalid_format' };
    // Per-kiosk lockout: FAILURES only are counted (a busy kiosk with many successful clock-ins is never throttled).
    // The window is checked BEFORE the scan so a locked kiosk never touches a hash. A limiter error fails CLOSED — an
    // unprotected 4-digit space is worse than a kiosk that asks the technician to see a manager.
    const limiterKey = `${ctx.tenantId}|${kioskKey || ctx.branchId || 'kiosk'}`;
    if (this.kioskLimiter) {
      let seen: { count: number; oldestMs: number | null };
      try { seen = await this.kioskLimiter.count(KIOSK_PIN_FAIL_SCOPE, limiterKey, KIOSK_PIN_FAIL_WINDOW_MS); }
      catch { throw new KioskPinLockedError(KIOSK_PIN_FAIL_WINDOW_MS); }
      if (seen.count >= KIOSK_PIN_FAIL_LIMIT) {
        throw new KioskPinLockedError(Math.max(1, (seen.oldestMs ?? Date.now()) + KIOSK_PIN_FAIL_WINDOW_MS - Date.now()));
      }
    }
    const candidates = await this.repo.listActivePinnedTechnicians(ctx);
    const matches: string[] = [];
    for (const c of candidates) {
      if (isLocked(c, nowIso)) continue;
      if (await verifyPassword(pin, c.pinHash).catch(() => false)) matches.push(c.technicianId);
    }
    if (matches.length === 1) {
      const only = candidates.find((c) => c.technicianId === matches[0])!;
      if (only.failedAttempts !== 0 || only.lockedUntil) await this.persist(ctx, matches[0], clearFailures());
      return { outcome: 'identified', technicianId: matches[0] };
    }
    if (matches.length > 1) return { outcome: 'duplicate_match' };
    if (this.kioskLimiter) {
      try { await this.kioskLimiter.record(KIOSK_PIN_FAIL_SCOPE, limiterKey); }
      catch { throw new KioskPinLockedError(KIOSK_PIN_FAIL_WINDOW_MS); }   // cannot count the failure → do not answer
    }
    return { outcome: 'no_match' };
  }
}
