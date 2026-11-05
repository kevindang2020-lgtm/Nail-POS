// ONE-PAY F8 (Oct 13 2026): the membership technician / owner split is the SAME percent split the compensation engine
// uses (@aipowersalon/money splitByPercent) — not a second copy of the arithmetic. Same results on every valid input,
// and the shared guard: a missing / unreadable percent pays the technician 0 and the owner everything, never NaN.
import { describe, it, expect } from 'vitest';
import { splitByPercent } from '@aipowersalon/money';
import { splitMembershipRevenue } from './memberships-core';

describe('membership split = the one percent split (ONE-PAY F8)', () => {
  it.each([[4500, 60], [999, 33], [1, 50], [0, 60], [12345, 47.5], [1000, 150], [1000, -5]])('%s @ %s%%', (base, pct) => {
    const s = splitByPercent(base, pct);
    expect(splitMembershipRevenue(base, pct)).toEqual({ techCents: s.shareCents, ownerCents: s.remainderCents });
  });
  it('an unreadable percent never produces NaN money', () => {
    expect(splitMembershipRevenue(1000, NaN)).toEqual({ techCents: 0, ownerCents: 1000 });
    expect(splitMembershipRevenue(1000, undefined as any)).toEqual({ techCents: 0, ownerCents: 1000 });
  });
});
