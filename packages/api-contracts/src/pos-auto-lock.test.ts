// pos-auto-lock.test.ts — Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a
// full sign-in after 8 hours locked." The ONE copy of the rules the API (session lock), the settings validation and the POS use.
import { describe, it, expect } from 'vitest';
import {
  AUTO_LOCK_DEFAULT, SALON_AUTO_LOCK_MINUTE_CHOICES, DEVICE_AUTO_LOCK_MINUTE_CHOICES, LOCKED_FULL_SIGN_IN_HOURS, SESSION_LOCK_MAX_MS,
  POS_CLIENT_TYPE, posClientType, autoLockPolicyFrom, serverLockedAt, sessionLockState, effectiveDeviceLock,
} from './pos-auto-lock';

const T0 = Date.parse('2026-10-12T09:00:00Z');
const MIN = 60_000;
const pos = (over: Partial<Parameters<typeof serverLockedAt>[0]> = {}) => ({ clientApp: 'pos', tenantId: 't-1', lastActivityAt: T0, lockedAt: null, ...over });

describe('POS auto-lock rules', () => {
  it('defaults: ON at 60 minutes; full sign-in after 8 hours locked; 60 is a salon and a device choice', () => {
    expect(AUTO_LOCK_DEFAULT).toEqual({ enabled: true, minutes: 60 });
    expect(LOCKED_FULL_SIGN_IN_HOURS).toBe(8);
    expect(SESSION_LOCK_MAX_MS).toBe(8 * 3_600_000);
    expect(SALON_AUTO_LOCK_MINUTE_CHOICES).toContain(60);
    expect(DEVICE_AUTO_LOCK_MINUTE_CHOICES).toContain(60);
    expect(DEVICE_AUTO_LOCK_MINUTE_CHOICES).toContain(1);            // Decision 35: the device may still pick a shorter time
  });

  it('a salon that never saved a value gets the default; a saved value is used only when it is a listed choice', () => {
    expect(autoLockPolicyFrom(undefined)).toEqual({ enabled: true, minutes: 60 });
    expect(autoLockPolicyFrom({ pinLogin: true })).toEqual({ enabled: true, minutes: 60 });          // saved before this field existed
    expect(autoLockPolicyFrom({ autoLockEnabled: false, autoLockMinutes: 30 })).toEqual({ enabled: false, minutes: 30 });
    expect(autoLockPolicyFrom({ autoLockEnabled: 'no', autoLockMinutes: 7 })).toEqual({ enabled: true, minutes: 60 });
  });

  it('only the exact client type "pos" is a POS device; mobile apps, native, kiosk, display and no header are not', () => {
    expect(POS_CLIENT_TYPE).toBe('pos');
    expect(posClientType({ 'x-client-type': 'pos' })).toBe('pos');
    for (const v of ['native', 'tech', 'owner', 'customer', 'manager-pay', 'kiosk', 'customer-display', 'POS ', 'pos2', '']) expect(posClientType({ 'x-client-type': v })).toBeNull();
    expect(posClientType({})).toBeNull();
    expect(posClientType(undefined)).toBeNull();
  });

  it('a POS session idle for the salon minutes is locked AT last activity + minutes (not at "now")', () => {
    const p = { enabled: true, minutes: 60 };
    expect(serverLockedAt(pos(), p, T0 + 60 * MIN - 1)).toBeNull();
    expect(serverLockedAt(pos(), p, T0 + 60 * MIN)).toBe(T0 + 60 * MIN);
    expect(serverLockedAt(pos(), p, T0 + 10 * 3_600_000)).toBe(T0 + 60 * MIN);   // came back the next morning: locked since 10:00
  });

  it('no idle lock for a non-POS session, a session with no salon, a salon that switched it off, or no recorded activity', () => {
    const p = { enabled: true, minutes: 60 }; const late = T0 + 5 * 3_600_000;
    expect(serverLockedAt(pos({ clientApp: null }), p, late)).toBeNull();
    expect(serverLockedAt(pos({ clientApp: 'tech' }), p, late)).toBeNull();
    expect(serverLockedAt(pos({ tenantId: null }), p, late)).toBeNull();
    expect(serverLockedAt(pos({ lastActivityAt: null }), p, late)).toBeNull();
    expect(serverLockedAt(pos(), { enabled: false, minutes: 60 }, late)).toBeNull();
  });

  it('an explicit lock (the device locked itself sooner, POST /auth/lock) always counts, for any session', () => {
    expect(serverLockedAt(pos({ lockedAt: T0 + 5 * MIN }), { enabled: false, minutes: 60 }, T0 + 6 * MIN)).toBe(T0 + 5 * MIN);
    expect(serverLockedAt(pos({ clientApp: null, lockedAt: T0 }), { enabled: true, minutes: 60 }, T0 + 1)).toBe(T0);
  });

  it('state: unlocked → locked → expired once locked for MORE than 8 hours', () => {
    const p = { enabled: true, minutes: 60 }; const lockAt = T0 + 60 * MIN;
    expect(sessionLockState(pos(), p, T0 + 59 * MIN)).toEqual({ state: 'unlocked', lockedAt: null });
    expect(sessionLockState(pos(), p, lockAt + 8 * 3_600_000)).toEqual({ state: 'locked', lockedAt: lockAt });
    expect(sessionLockState(pos(), p, lockAt + 8 * 3_600_000 + 1)).toEqual({ state: 'expired', lockedAt: lockAt });
  });

  it('the device may lock sooner than the salon, never later; with the salon lock off the device decides', () => {
    expect(effectiveDeviceLock({ enabled: true, minutes: 5 }, { enabled: true, minutes: 60 })).toEqual({ enabled: true, minutes: 5 });
    expect(effectiveDeviceLock({ enabled: true, minutes: 120 }, { enabled: true, minutes: 60 })).toEqual({ enabled: true, minutes: 60 });
    expect(effectiveDeviceLock({ enabled: false, minutes: 5 }, { enabled: true, minutes: 30 })).toEqual({ enabled: true, minutes: 30 });   // cannot switch the salon's lock off
    expect(effectiveDeviceLock({ enabled: false, minutes: 5 }, { enabled: false, minutes: 60 })).toEqual({ enabled: false, minutes: 5 });
    expect(effectiveDeviceLock({ enabled: true, minutes: 15 }, { enabled: false, minutes: 60 })).toEqual({ enabled: true, minutes: 15 });
  });
});
