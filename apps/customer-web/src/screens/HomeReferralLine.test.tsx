// Refer a Friend build (Nov 5 2026) R030–R033: the Home banner states the salon's live offer, never a hard-coded "$10".
import { describe, it, expect } from 'vitest';
import { referralLine } from './HomeScreen';

describe('Home — Refer a Friend banner text', () => {
  it('no funded offer → no money claim', () => { expect(referralLine(null)).toBe('Invite friends to your salon.'); expect(referralLine(null)).not.toMatch(/\$/); });
  it('equal amounts → "You both get"', () => { expect(referralLine({ friendRewardCents: 1000, referrerRewardCents: 1000, minSpendCents: 0, expiryDays: 90 })).toBe('You both get $10 in rewards.'); });
  it('different amounts → each side named', () => { expect(referralLine({ friendRewardCents: 1000, referrerRewardCents: 1550, minSpendCents: 0, expiryDays: 90 })).toBe('Give your friend $10, earn $15.50.'); });
});
