import { describe, it, expect } from 'vitest';
import { giftReadiness } from './giftReadiness';

describe('giftReadiness (Gift Cards · 03 Checkout Redemption Readiness)', () => {
  it('a card smaller than the due covers its balance and leaves the rest for another tender (split)', () => {
    expect(giftReadiness({ found: true, balanceCents: 3500, status: 'active', redeemableHere: true }, 8000)).toEqual({
      ready: true, balanceCents: 3500, dueCents: 8000, appliedCents: 3500, remainingDueCents: 4500, cardAfterCents: 0, splitNeeded: true, blockers: [],
    });
  });
  it('a card larger than the due covers the whole ticket and keeps the rest on the card', () => {
    expect(giftReadiness({ found: true, balanceCents: 10000, status: 'active', redeemableHere: true }, 6250)).toMatchObject({ ready: true, appliedCents: 6250, remainingDueCents: 0, cardAfterCents: 3750, splitNeeded: false });
  });
  it('not found is a blocker with an unknown balance, never $0', () => {
    const v = giftReadiness({ found: false }, 5000);
    expect(v).toMatchObject({ ready: false, balanceCents: null, appliedCents: 0, remainingDueCents: 5000, blockers: ['not_found'] });
  });
  it('each eligibility problem blocks and nothing is applied', () => {
    expect(giftReadiness({ found: true, balanceCents: 0, status: 'redeemed' }, 5000)).toMatchObject({ ready: false, appliedCents: 0, blockers: ['no_balance'] });
    expect(giftReadiness({ found: true, balanceCents: 2000, status: 'frozen', redeemableHere: false }, 5000)).toMatchObject({ ready: false, blockers: ['status'] });
    expect(giftReadiness({ found: true, balanceCents: 2000, status: 'active', redeemableHere: false }, 5000)).toMatchObject({ ready: false, blockers: ['not_here'] });
  });
  it('ticket and register blockers: paid ticket, offline, payment phone, gift tender disabled', () => {
    const v = giftReadiness({ found: true, balanceCents: 2000, status: 'active', redeemableHere: true }, 0, { offline: true, phoneClaim: true, giftEnabled: false });
    expect(v.ready).toBe(false);
    expect(v.blockers).toEqual(['disabled', 'offline', 'phone_claim', 'already_paid']);
    expect(v.appliedCents).toBe(0);
  });
});
