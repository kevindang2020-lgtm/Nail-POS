// biometric-failures.ts — Secure Tap to Pay §12 (Oct 26 2026): "after repeated biometric failures, require full
// authentication". ONE counter for every gate that asks verifyDeviceOwner() (the app lock, Return to Staff): a failed or
// cancelled Face ID / Touch ID / passcode check counts; a success resets it. At BIOMETRIC_MAX_FAILURES the gate signs the
// person out (password sign-in). The count survives a relaunch (localStorage) so killing the app does not reset the
// budget; when storage is unavailable it is kept in memory for this run. Never throws.
export const BIOMETRIC_MAX_FAILURES = 3;
const KEY = 'aps.biometric.failures';
let memory = 0;

function read(): number {
  try { const v = Number(globalThis.localStorage?.getItem(KEY) ?? memory); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; } catch { return memory; }
}
function write(n: number): void {
  memory = n;
  try { if (n > 0) globalThis.localStorage?.setItem(KEY, String(n)); else globalThis.localStorage?.removeItem(KEY); } catch { /* memory keeps it for this run */ }
}

/** Failures since the last success. */
export function biometricFailures(): number { return read(); }
/** Count one failed / cancelled check; returns the new count. */
export function recordBiometricFailure(): number { const n = read() + 1; write(n); return n; }
/** A successful check (or a full password sign-in) clears the budget. */
export function resetBiometricFailures(): void { write(0); }
/** true when this count must end in a full sign-in. */
export function biometricLockedOut(n: number, max = BIOMETRIC_MAX_FAILURES): boolean { return max > 0 && n >= max; }
