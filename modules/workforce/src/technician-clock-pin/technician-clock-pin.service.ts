// technician-clock-pin.service.ts — the secure primitive the Go Check-In clock flow builds on: set and verify a
// technician's 4-digit Clock PIN. The PIN is hashed (scrypt, in the same self-describing format as passwords, at the
// PIN's own cost — clock-pin-hash.ts, M4-1), never stored or logged in plaintext. Verification is rate-limited (see
// clock-pin-core) so a 4-digit space can't be brute-forced. Everything is tenant-scoped via ctx.
//
// This slice deliberately exposes NO HTTP surface. It is the domain primitive; the identify-by-PIN lookup, the
// clock-in/out wiring to the existing time-clock service, the kiosk UI, and the manager reset endpoint build on top of
// it in later slices.
import { hashClockPin, verifyClockPin, clockPinNeedsRehash } from './clock-pin-hash';
import { isValidPinFormat, isWeakPin, isLocked, registerFailure, clearFailures, type PinRateState } from './clock-pin-core';
import { mapLimit, type PinLookupKey } from './clock-pin-lookup';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

/** A keyed digest of (tenant, PIN) and the id of the key that made it (see clock-pin-lookup.ts). */
export interface PinLookup { value: string; kid: string; }

export interface ClockPinContext { tenantId: string; branchId?: string | null; }

export interface ClockPinRow { pinHash: string; failedAttempts: number; lockedUntil: string | null; }

/** A technician (active account + membership) at the device's branch who has a Clock PIN set. */
export interface PinnedTechnician { technicianId: string; pinHash: string; failedAttempts: number; lockedUntil: string | null; lookupKid?: string | null; }

export interface ClockPinRepository {
  getPin(ctx: ClockPinContext, technicianId: string): Promise<ClockPinRow | null>;
  upsertPin(ctx: ClockPinContext, technicianId: string, pinHash: string, actorId: string | null, lookup?: PinLookup | null): Promise<void>;
  updateRateState(ctx: ClockPinContext, technicianId: string, state: PinRateState): Promise<void>;
  /** Active technicians at this tenant/branch who have a Clock PIN — the only candidates an identify scan considers.
   *  With `lookup`: only rows whose digest matches under that key, PLUS rows keyed under another key / not keyed yet. */
  listActivePinnedTechnicians(ctx: ClockPinContext, lookup?: PinLookup | null): Promise<PinnedTechnician[]>;
  /** Store a row's digest (a legacy row re-keyed after a successful match). Optional: adapters without it stay unkeyed. */
  setLookup?(ctx: ClockPinContext, technicianId: string, lookup: PinLookup): Promise<void>;
  /** M4-1: replace ONLY the hash (a password-cost hash re-hashed at the PIN cost after a successful verification) — the
   *  lookup digest, the attempt counters and who set the PIN are untouched. Optional: adapters without it keep the old hash. */
  setPinHash?(ctx: ClockPinContext, technicianId: string, pinHash: string): Promise<void>;
}

export class ClockPinValidationError extends Error {}
/** §47: the PIN is already another active technician's at this salon (a manager picks another). */
export class ClockPinInUseError extends ClockPinValidationError {}
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
  constructor(private readonly repo: ClockPinRepository, private readonly kioskLimiter?: KioskPinLimiter, private readonly lookupKey: PinLookupKey | null = null) {}

  private lookupFor(ctx: ClockPinContext, pin: string): PinLookup | null {
    return this.lookupKey ? { value: this.lookupKey.digest(ctx.tenantId, pin), kid: this.lookupKey.kid } : null;
  }

  /** Set or reset a technician's Clock PIN. `actorId` is the manager who did it, or null for self/onboarding. */
  async setPin(ctx: ClockPinContext, technicianId: string, pin: string, actorId: string | null): Promise<void> {
    if (!technicianId) throw new ClockPinValidationError('technicianId is required');
    if (!isValidPinFormat(pin)) throw withCode(new ClockPinValidationError('The Clock PIN must be exactly 4 digits.'), 'CLOCK_PIN_FORMAT');
    if (isWeakPin(pin)) throw withCode(new ClockPinValidationError('Please choose a less predictable PIN.'), 'CLOCK_PIN_PREDICTABLE');
    const lookup = this.lookupFor(ctx, pin);
    // §47: a 4-digit PIN must be unique where the kiosk identifies by it (this tenant + branch — never assumed unique
    // across tenants). With 200 technicians, random PINs collide more often than not, and a shared PIN makes the kiosk
    // answer "duplicate" for BOTH people. Only a manager sets PINs (resetPin), so telling them is not an oracle for a
    // technician. Rows not keyed yet cannot be compared without their PIN; identify still reports those as duplicates.
    if (lookup) {
      const clash = (await this.repo.listActivePinnedTechnicians(ctx, lookup))
        .filter((c) => c.technicianId !== technicianId && c.lookupKid === lookup.kid);
      if (clash.length) throw withCode(new ClockPinInUseError('Another technician at this salon already uses this PIN. Choose a different PIN.'), 'PIN_IN_USE');
    }
    const pinHash = await hashClockPin(pin);
    await this.repo.upsertPin(ctx, technicianId, pinHash, actorId, lookup);
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
    const matches = await verifyClockPin(pin, row.pinHash).catch(() => false);
    if (matches) {
      if (row.failedAttempts !== 0 || row.lockedUntil) await this.persist(ctx, technicianId, clearFailures());
      await this.rehashIfStale(ctx, technicianId, pin, row.pinHash);
      return { ok: true };
    }
    await this.persist(ctx, technicianId, registerFailure(row, nowIso));
    return { ok: false, reason: 'mismatch' };
  }

  private persist(ctx: ClockPinContext, technicianId: string, state: PinRateState) {
    return this.repo.updateRateState(ctx, technicianId, state);
  }

  /** M4-1: a hash that verified but is not at the PIN cost (set before Oct 26 2026 at the password cost) is replaced
   *  with a fresh PIN-cost hash of the SAME PIN — the technician notices nothing; the next tap costs ~4 ms, not ~34. */
  private async rehashIfStale(ctx: ClockPinContext, technicianId: string, pin: string, storedHash: string): Promise<void> {
    if (!this.repo.setPinHash || !clockPinNeedsRehash(storedHash)) return;
    await this.repo.setPinHash(ctx, technicianId, await hashClockPin(pin));
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
    const lookup = this.lookupFor(ctx, pin);
    const candidates = await this.repo.listActivePinnedTechnicians(ctx, lookup);
    // Every candidate is still checked against its scrypt hash (a digest match alone never identifies anyone); with a
    // key the candidates are the digest matches plus any rows not keyed under it yet. Checked a few at a time.
    const open = candidates.filter((c) => !isLocked(c, nowIso));
    const ok = await mapLimit(open, 4, (c) => verifyClockPin(pin, c.pinHash).catch(() => false));
    const matches: string[] = open.filter((_, i) => ok[i]).map((c) => c.technicianId);
    if (lookup && this.repo.setLookup) {
      for (const c of open) if (ok[open.indexOf(c)] && c.lookupKid !== lookup.kid) await this.repo.setLookup(ctx, c.technicianId, lookup);
    }
    if (matches.length === 1) {
      const only = candidates.find((c) => c.technicianId === matches[0])!;
      if (only.failedAttempts !== 0 || only.lockedUntil) await this.persist(ctx, matches[0], clearFailures());
      await this.rehashIfStale(ctx, matches[0], pin, only.pinHash);
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
