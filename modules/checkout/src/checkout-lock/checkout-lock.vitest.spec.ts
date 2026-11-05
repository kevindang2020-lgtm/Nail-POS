import { describe, it, expect } from 'vitest';
import { decideAcquire, isExpired, ownsLock, type ActiveLockView, type LockRequester } from './checkout-lock-core';
import { CheckoutLockService, LockHeldElsewhereError, LockNotHeldError } from './checkout-lock.service';
import { InMemoryCheckoutLockRepository } from './checkout-lock.repository';

const T0 = new Date('2026-06-28T10:00:00Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

const lockView = (over: Partial<ActiveLockView> = {}): ActiveLockView => ({
  ownerUserId: 'u1', ownerDeviceId: 'd1', sessionId: 's1', source: 'mobile', expiresAt: later(90_000).toISOString(), ...over,
});
const req = (over: Partial<LockRequester> = {}): LockRequester => ({ userId: 'u1', deviceId: 'd1', sessionId: 's1', source: 'mobile', ...over });

describe('checkout-lock core', () => {
  it('no active lock -> acquire', () => {
    expect(decideAcquire(null, req(), T0)).toEqual({ action: 'acquire' });
  });
  it('caller owns the active lock -> refresh', () => {
    expect(decideAcquire(lockView({ sessionId: 's1' }), req({ sessionId: 's1' }), T0).action).toBe('refresh');
  });
  it('another session holds an unexpired lock -> rejected', () => {
    const d = decideAcquire(lockView({ sessionId: 'other' }), req({ sessionId: 's1' }), T0);
    expect(d.action).toBe('rejected');
  });
  it('expired lock -> takeover', () => {
    const expired = lockView({ sessionId: 'other', expiresAt: later(-1).toISOString() });
    const d = decideAcquire(expired, req({ sessionId: 's1' }), T0);
    expect(d.action).toBe('takeover');
  });
  it('isExpired / ownsLock helpers', () => {
    expect(isExpired({ expiresAt: later(-1).toISOString() }, T0)).toBe(true);
    expect(isExpired({ expiresAt: later(1000).toISOString() }, T0)).toBe(false);
    expect(isExpired({ expiresAt: 'garbage' }, T0)).toBe(true);
    expect(ownsLock(lockView({ sessionId: 's1' }), req({ sessionId: 's1' }))).toBe(true);
    expect(ownsLock(lockView({ sessionId: 's1' }), req({ sessionId: 's2' }))).toBe(false);
  });
});

describe('checkout-lock service (in-memory)', () => {
  const mk = () => new CheckoutLockService(new InMemoryCheckoutLockRepository(), 90_000);
  const base = { tenantId: 'T1', branchId: 'B1', ticketId: 'tk1' };

  it('first device acquires; same session re-acquire refreshes', async () => {
    const svc = mk();
    const r1 = await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, T0);
    expect(r1.action).toBe('acquired');
    const r2 = await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, later(1000));
    expect(r2.action).toBe('refreshed');
  });

  it('a second device is rejected with 409-worthy error while the lock is held', async () => {
    const svc = mk();
    await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, T0);
    await expect(svc.acquire({ ...base, ...req({ userId: 'u2', sessionId: 's2' }) }, later(1000)))
      .rejects.toBeInstanceOf(LockHeldElsewhereError);
  });

  it('an expired lock can be taken over by another device', async () => {
    const svc = mk();
    await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, T0);
    // 91s later the first lock has expired
    const r = await svc.acquire({ ...base, ...req({ userId: 'u2', sessionId: 's2' }) }, later(91_000));
    expect(r.action).toBe('taken_over');
    const status = await svc.getStatus('T1', 'tk1', 's2', later(91_500));
    expect(status.locked).toBe(true);
    expect(status.ownedByCaller).toBe(true);
  });

  it('refresh by a non-owner while held elsewhere throws held-elsewhere; refresh with no lock throws not-held', async () => {
    const svc = mk();
    await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, T0);
    await expect(svc.refresh('T1', 'tk1', 's2', later(1000))).rejects.toBeInstanceOf(LockHeldElsewhereError);
    const svc2 = mk();
    await expect(svc2.refresh('T1', 'tk1', 's9', T0)).rejects.toBeInstanceOf(LockNotHeldError);
  });

  it('release frees the lock so another device can acquire', async () => {
    const svc = mk();
    await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, T0);
    expect((await svc.release('T1', 'tk1', 's1', 'done')).released).toBe(true);
    const r = await svc.acquire({ ...base, ...req({ userId: 'u2', sessionId: 's2' }) }, later(1000));
    expect(r.action).toBe('acquired');
  });

  it('status reports unlocked when no active lock and when the lock has expired', async () => {
    const svc = mk();
    expect((await svc.getStatus('T1', 'tk1', 's1', T0)).locked).toBe(false);
    await svc.acquire({ ...base, ...req({ sessionId: 's1' }) }, T0);
    expect((await svc.getStatus('T1', 'tk1', 's1', later(1000))).locked).toBe(true);
    expect((await svc.getStatus('T1', 'tk1', 's1', later(91_000))).locked).toBe(false); // expired
  });
});
