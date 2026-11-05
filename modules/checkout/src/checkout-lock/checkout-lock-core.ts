import type { LockSource } from '@aipowersalon/api-contracts/tenant';
export type { LockSource };   // owned by packages/api-contracts (Constitution 13 §13)
// checkout-lock-core.ts — pure, I/O-free decision logic for the checkout-session lock. The session id is the ownership
// key (a given device+login session). The rules:
//   • no active lock                      -> acquire
//   • caller already owns the active lock -> refresh (idempotent re-open / heartbeat)
//   • active lock owned by someone else, not expired -> rejected (POS/another device has it)
//   • active lock expired                 -> takeover (release the stale one, then acquire)
// This keeps the authoritative concurrency RULES in one exhaustively-tested place; the repository enforces the DB-level
// "one active lock per ticket" guarantee (partial unique index) so two concurrent acquires can never both win.


export interface ActiveLockView {
  ownerUserId: string;
  ownerDeviceId?: string;
  sessionId: string;
  source: LockSource;
  expiresAt: string;
}

export interface LockRequester {
  userId: string;
  deviceId?: string;
  sessionId: string;
  source: LockSource;
}

export type AcquireDecision =
  | { action: 'acquire' }
  | { action: 'refresh' }
  | { action: 'takeover'; staleSessionId: string }
  | { action: 'rejected'; heldBy: ActiveLockView };

export function isExpired(lock: { expiresAt: string }, now: Date): boolean {
  const t = new Date(lock.expiresAt).getTime();
  return Number.isNaN(t) ? true : t <= now.getTime();
}

export function ownsLock(lock: ActiveLockView, req: LockRequester): boolean {
  return lock.sessionId === req.sessionId;
}

export function decideAcquire(current: ActiveLockView | null, req: LockRequester, now: Date): AcquireDecision {
  if (!current) return { action: 'acquire' };
  if (ownsLock(current, req)) return { action: 'refresh' };
  if (isExpired(current, now)) return { action: 'takeover', staleSessionId: current.sessionId };
  return { action: 'rejected', heldBy: current };
}

/** Next expiry timestamp as ISO. ttlMs defaults are decided by the service. */
export function nextExpiry(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

/** A safe, non-leaky description of who holds a contended lock (for the "in progress" message). */
export function heldByLabel(lock: ActiveLockView): string {
  if (lock.source === 'display') return 'The customer is paying for this ticket by card on the terminal right now. Wait for it to finish.';
  return lock.source === 'pos' ? 'A payment for this ticket is being taken at the front desk right now.' : 'This ticket is open on another device.';
}
