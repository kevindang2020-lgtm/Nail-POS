// clock-pin-core.ts — pure, DB-free policy for the technician Clock PIN. All rules that don't need the database live
// here so they're cheap to unit-test: PIN format, and the rate-limit lockout state machine. No plaintext PIN is ever
// logged or returned by anything in this module.

/** A Clock PIN is exactly four digits. Rejects non-digits, wrong length, and anything with separators/spaces. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

// Weak-PIN guard: refuse trivially guessable PINs (all-same, simple ascending/descending runs). Kept small and
// explicit rather than clever — these are the ones worth blocking at set-time.
const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '2345', '3456', '4567', '5678', '6789', '0123', '4321', '9876']);
export function isWeakPin(pin: string): boolean {
  return WEAK_PINS.has(pin);
}

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000; // 15 minutes

export interface PinRateState {
  failedAttempts: number;
  lockedUntil: string | null; // ISO, or null
}

/** True when the PIN is currently locked (lockedUntil is in the future relative to `nowIso`). */
export function isLocked(state: Pick<PinRateState, 'lockedUntil'>, nowIso: string): boolean {
  if (!state.lockedUntil) return false;
  return new Date(state.lockedUntil).getTime() > new Date(nowIso).getTime();
}

/**
 * Next rate-limit state after one WRONG attempt. At the threshold it sets a lock window; a lock resets the counter so
 * that, once the lock expires, the technician gets a fresh set of attempts rather than being permanently one-away.
 */
export function registerFailure(state: PinRateState, nowIso: string): PinRateState {
  const attempts = state.failedAttempts + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: new Date(new Date(nowIso).getTime() + LOCK_MS).toISOString() };
  }
  return { failedAttempts: attempts, lockedUntil: null };
}

/** State after a SUCCESSFUL verification: counter cleared, no lock. */
export function clearFailures(): PinRateState {
  return { failedAttempts: 0, lockedUntil: null };
}
