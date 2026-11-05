// checkout-lock.service.ts — orchestrates the checkout-session lock using the pure core + the repository. Reusable by
// the POS later (so it can both SHOW and RESPECT a mobile lock). Throws plain domain errors; the controller maps them.

import type { LockResult, LockStatus } from '@aipowersalon/api-contracts/tenant';
export type { LockResult, LockStatus };   // owned by packages/api-contracts (Constitution 13 §13)
import {
  decideAcquire, isExpired, nextExpiry, heldByLabel,
  type ActiveLockView, type LockRequester, type LockSource,
} from './checkout-lock-core';
import { CheckoutLockPort, LockContentionError, type HeldByQuery, type HeldLockView } from './checkout-lock.repository';

export class LockHeldElsewhereError extends Error {
  constructor(readonly heldBy: ActiveLockView, msg: string) { super(msg); this.name = 'LockHeldElsewhereError'; }
}
export class LockNotHeldError extends Error {
  constructor(msg = 'You no longer hold this checkout lock. Re-open the ticket.') { super(msg); this.name = 'LockNotHeldError'; }
}

export interface AcquireRequest extends LockRequester {
  tenantId: string;
  branchId?: string | null;
  ticketId: string;
}

const DEFAULT_TTL_MS = 90_000; // 90s; the app refreshes well before this while the ticket stays open

export class CheckoutLockService {
  constructor(private readonly repo: CheckoutLockPort, private readonly ttlMs: number = DEFAULT_TTL_MS) {}

  async getStatus(tenantId: string, ticketId: string, sessionId?: string, now: Date = new Date()): Promise<LockStatus> {
    const cur = await this.repo.getActive(tenantId, ticketId);
    if (!cur || isExpired(cur, now)) return { locked: false, ownedByCaller: false, heldBy: null };
    return {
      locked: true,
      ownedByCaller: !!sessionId && cur.sessionId === sessionId,
      heldBy: { source: cur.source, message: heldByLabel(cur), expiresAt: cur.expiresAt },
    };
  }

  /** The raw active lock (owner user / device / session / source / expiry) — for the claim views (mandate §45). */
  async active(tenantId: string, ticketId: string, now: Date = new Date()): Promise<ActiveLockView | null> {
    const cur = await this.repo.getActive(tenantId, ticketId);
    return !cur || isExpired(cur, now) ? null : cur;
  }

  /** Mandate §120: the live (unreleased, unexpired) locks of one source in one branch held by this user or this device. */
  async heldBy(tenantId: string, by: HeldByQuery, now: Date = new Date()): Promise<HeldLockView[]> {
    if (!this.repo.activeHeldBy) return [];
    return (await this.repo.activeHeldBy(tenantId, by)).filter((l) => !isExpired(l, now));
  }

  /** §46 authorized takeover: release whoever holds the ticket (the caller has checked the permission + no in-flight charge). */
  async forceRelease(tenantId: string, ticketId: string, reason: string): Promise<void> {
    await this.repo.releaseStale(tenantId, ticketId, reason);
  }

  async acquire(req: AcquireRequest, now: Date = new Date()): Promise<LockResult> {
    const cur = await this.repo.getActive(req.tenantId, req.ticketId);
    const decision = decideAcquire(cur, req, now);
    const expiresAt = nextExpiry(now, this.ttlMs);

    if (decision.action === 'rejected') throw new LockHeldElsewhereError(decision.heldBy, heldByLabel(decision.heldBy));
    if (decision.action === 'refresh') {
      await this.repo.refresh(req.tenantId, req.ticketId, req.sessionId, expiresAt);
      return { acquired: true, action: 'refreshed', expiresAt };
    }
    if (decision.action === 'takeover') await this.repo.releaseStale(req.tenantId, req.ticketId, 'expired_takeover');

    try {
      await this.repo.insert({
        tenantId: req.tenantId, branchId: req.branchId, ticketId: req.ticketId,
        ownerUserId: req.userId, ownerDeviceId: req.deviceId, sessionId: req.sessionId, source: req.source, expiresAt,
      });
    } catch (e) {
      if (e instanceof LockContentionError) {
        // Lost an insert race: re-read. If somehow it's ours, treat as acquired; else someone else won.
        const after = await this.repo.getActive(req.tenantId, req.ticketId);
        if (after && after.sessionId === req.sessionId) return { acquired: true, action: 'acquired', expiresAt: after.expiresAt };
        if (after) throw new LockHeldElsewhereError(after, heldByLabel(after));
      }
      throw e;
    }
    return { acquired: true, action: decision.action === 'takeover' ? 'taken_over' : 'acquired', expiresAt };
  }

  async refresh(tenantId: string, ticketId: string, sessionId: string, now: Date = new Date()): Promise<LockResult> {
    const expiresAt = nextExpiry(now, this.ttlMs);
    const ok = await this.repo.refresh(tenantId, ticketId, sessionId, expiresAt);
    if (ok) return { acquired: true, action: 'refreshed', expiresAt };
    const cur = await this.repo.getActive(tenantId, ticketId);
    if (cur && cur.sessionId !== sessionId && !isExpired(cur, now)) throw new LockHeldElsewhereError(cur, heldByLabel(cur));
    throw new LockNotHeldError();
  }

  async release(tenantId: string, ticketId: string, sessionId: string, reason = 'released'): Promise<{ released: boolean }> {
    return { released: await this.repo.release(tenantId, ticketId, sessionId, reason) };
  }
}
