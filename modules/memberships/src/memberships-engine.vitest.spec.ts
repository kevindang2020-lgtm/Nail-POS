// memberships-engine.vitest.spec.ts — DB-free unit tests for the pure membership engine: the lifecycle state machine,
// the double-spend-safe credit-balance derivation, and the integer-cent technician/owner split.
import { describe, it, expect } from 'vitest';
import {
  canTransition, assertTransition, MembershipTransitionError, benefitsActive,
  creditBalance, canReserveServiceCredit, splitMembershipRevenue, isValidSplit, upgradeChargeCents, isRecurring,
} from './memberships-core';

describe('membership state machine', () => {
  it('allows valid transitions', () => {
    expect(canTransition('pending', 'active')).toBe(true);
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
    expect(canTransition('active', 'canceling')).toBe(true);
    expect(canTransition('canceling', 'canceled')).toBe(true);
    expect(canTransition('past_due', 'active')).toBe(true);
  });

  it('rejects invalid transitions, including out of terminal states', () => {
    expect(canTransition('canceled', 'active')).toBe(false);
    expect(canTransition('expired', 'active')).toBe(false);
    expect(canTransition('pending', 'paused')).toBe(false);
    expect(() => assertTransition('canceled', 'active')).toThrow(MembershipTransitionError);
  });

  it('treats a same-state transition as an idempotent no-op', () => {
    expect(() => assertTransition('active', 'active')).not.toThrow();
  });

  it('knows when benefits are usable', () => {
    expect(benefitsActive('active')).toBe(true);
    expect(benefitsActive('trial')).toBe(true);
    expect(benefitsActive('comped')).toBe(true);
    expect(benefitsActive('paused')).toBe(false);
    expect(benefitsActive('past_due')).toBe(false);
    expect(benefitsActive('canceled')).toBe(false);
  });

  it('classifies recurring product types', () => {
    expect(isRecurring('recurring')).toBe(true);
    expect(isRecurring('hybrid')).toBe(true);
    expect(isRecurring('fixed_term')).toBe(false);
    expect(isRecurring('package')).toBe(false);
  });
});

describe('credit balance derivation', () => {
  it('grants and consumes service credits', () => {
    const b = creditBalance([
      { entryType: 'issued', quantity: 3 },
      { entryType: 'redeemed', quantity: 1 },
    ]);
    expect(b.serviceCreditsGranted).toBe(3);
    expect(b.serviceCreditsRedeemed).toBe(1);
    expect(b.serviceCreditsAvailable).toBe(2);
  });

  it('a reservation holds a credit (removed from available) without consuming it', () => {
    const b = creditBalance([
      { entryType: 'issued', quantity: 2 },
      { entryType: 'reserved', quantity: 1 },
    ]);
    expect(b.serviceCreditsReserved).toBe(1);
    expect(b.serviceCreditsAvailable).toBe(1); // 2 owned − 1 held
  });

  it('redeeming a reservation does not double-count (held → consumed)', () => {
    const b = creditBalance([
      { entryType: 'issued', quantity: 2 },
      { entryType: 'reserved', quantity: 1 },
      { entryType: 'redeemed', quantity: 1 },
    ]);
    expect(b.serviceCreditsReserved).toBe(0);
    expect(b.serviceCreditsRedeemed).toBe(1);
    expect(b.serviceCreditsAvailable).toBe(1); // exactly one consumed, one left — not two
  });

  it('releasing a reservation returns the credit to available', () => {
    const b = creditBalance([
      { entryType: 'issued', quantity: 2 },
      { entryType: 'reserved', quantity: 1 },
      { entryType: 'released', quantity: 1 },
    ]);
    expect(b.serviceCreditsReserved).toBe(0);
    expect(b.serviceCreditsAvailable).toBe(2);
  });

  it('expires credits and supports rollover carry-in', () => {
    const b = creditBalance([
      { entryType: 'issued', quantity: 1 },
      { entryType: 'expired', quantity: 1 },
      { entryType: 'rolled_over', quantity: 2 },
    ]);
    expect(b.serviceCreditsExpired).toBe(1);
    expect(b.serviceCreditsAvailable).toBe(2); // 1 issued − 1 expired + 2 rolled-over
  });

  it('derives dollar-credit balance the same way', () => {
    const b = creditBalance([
      { entryType: 'issued', amountCents: 5000 },
      { entryType: 'reserved', amountCents: 2000 },
      { entryType: 'redeemed', amountCents: 2000 },
    ]);
    expect(b.dollarCreditsReservedCents).toBe(0);
    expect(b.dollarCreditsAvailableCents).toBe(3000);
  });

  it('prevents reserving more than is owned', () => {
    const entries = [{ entryType: 'issued', quantity: 1 }];
    expect(canReserveServiceCredit(entries, 1)).toBe(true);
    expect(canReserveServiceCredit(entries, 2)).toBe(false);
    const afterReserve = [...entries, { entryType: 'reserved', quantity: 1 }];
    expect(canReserveServiceCredit(afterReserve, 1)).toBe(false); // nothing left to reserve
  });
});

describe('technician / owner split', () => {
  it('splits 60/40 and reconciles to the cent', () => {
    const s = splitMembershipRevenue(10000, 60);
    expect(s.techCents).toBe(6000);
    expect(s.ownerCents).toBe(4000);
    expect(s.techCents + s.ownerCents).toBe(10000);
  });

  it('owner takes the remainder so there is no penny drift on odd amounts', () => {
    const s = splitMembershipRevenue(9999, 60); // 60% = 5999.4 → 5999
    expect(s.techCents).toBe(5999);
    expect(s.ownerCents).toBe(4000);
    expect(s.techCents + s.ownerCents).toBe(9999);
  });

  it('validates that a split totals 100%', () => {
    expect(isValidSplit(60, 40)).toBe(true);
    expect(isValidSplit(55.5, 44.5)).toBe(true);
    expect(isValidSplit(60, 30)).toBe(false);
    expect(isValidSplit(70, 40)).toBe(false);
  });

  it('never exceeds the eligible amount or goes negative', () => {
    expect(splitMembershipRevenue(0, 60)).toEqual({ techCents: 0, ownerCents: 0 });
    expect(splitMembershipRevenue(5000, 100)).toEqual({ techCents: 5000, ownerCents: 0 });
    expect(splitMembershipRevenue(5000, 0)).toEqual({ techCents: 0, ownerCents: 5000 });
  });
});

describe('upgrade charge', () => {
  it('charges the difference above the included allocated value, less any member discount', () => {
    // included basic value $30, upgrade to gel $50, 10% member discount ≈ $2 → customer pays $18
    expect(upgradeChargeCents(5000, 3000, 200)).toBe(1800);
  });
  it('never goes negative when the included value covers the upgrade', () => {
    expect(upgradeChargeCents(3000, 5000, 0)).toBe(0);
  });
});
