// posSessionRenewal — the POS stays signed in while in use; a locked POS ends 8 h after the lock; 7-day hard cap.
import { describe, it, expect } from 'vitest';
import { posSessionRenewal } from './security';

const H = 3600_000, D = 24 * H, T0 = Date.UTC(2026, 10, 7, 14, 0, 0);
const env = {};
describe('posSessionRenewal (Nov 7 2026)', () => {
  it('in use: a renewal 11 h after sign-in pushes the end to now + 12 h (the busy evening no longer signs the desk out)', () => {
    const r = posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 12 * H, lockedAtMs: null }, T0 + 11 * H, env);
    expect(r).toEqual({ ended: false, expiresAtMs: T0 + 23 * H, changed: true });
  });
  it('in use: never shortens an end that is already later', () => {
    const r = posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 30 * D, lockedAtMs: null }, T0 + H, env);
    expect(r).toEqual({ ended: false, expiresAtMs: T0 + 7 * D, changed: true });   // …but the 7-day cap still applies
  });
  it('locked: no growth, and the session ends 8 h after the lock', () => {
    const lockAt = T0 + 2 * H;
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 12 * H, lockedAtMs: lockAt }, T0 + 3 * H, env)).toEqual({ ended: false, expiresAtMs: lockAt + 8 * H, changed: true });
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 12 * H, lockedAtMs: lockAt }, lockAt + 8 * H, env)).toEqual({ ended: true });
  });
  it('hard cap: 7 days after sign-in it ends even while in use', () => {
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 7 * D - H, lockedAtMs: null }, T0 + 7 * D, env)).toEqual({ ended: true });
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 6 * D + 20 * H, lockedAtMs: null }, T0 + 6 * D + 18 * H, env)).toEqual({ ended: false, expiresAtMs: T0 + 7 * D, changed: true });
  });
  it('env knobs are bounded: the cap cannot go past 30 days or under 12 h; the locked window cannot go under 15 min', () => {
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + H, lockedAtMs: null }, T0, { AUTH_POS_SESSION_MAX_SECONDS: String(365 * 86400) })).toEqual({ ended: false, expiresAtMs: T0 + 12 * H, changed: true });
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 12 * H, lockedAtMs: null }, T0 + 10 * H, { AUTH_POS_SESSION_MAX_SECONDS: '60' })).toEqual({ ended: false, expiresAtMs: T0 + 12 * H, changed: false });
    expect(posSessionRenewal({ createdAtMs: T0, expiresAtMs: T0 + 12 * H, lockedAtMs: T0 }, T0 + 60_000, { AUTH_POS_LOCKED_MAX_SECONDS: '1' })).toEqual({ ended: false, expiresAtMs: T0 + 15 * 60_000, changed: true });
  });
});
