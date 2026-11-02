import { describe, it, expect } from 'vitest';
import { computeDealDiscountCents, resolveStacking } from './deals-checkout-core';

describe('computeDealDiscountCents', () => {
  it('percent of subtotal, rounded', () => {
    expect(computeDealDiscountCents(5000, 'percent', 20, null)).toBe(1000);
    expect(computeDealDiscountCents(4999, 'percent', 20, null)).toBe(1000); // rounds
  });
  it('fixed amount, capped at subtotal', () => {
    expect(computeDealDiscountCents(5000, 'fixed', null, 1500)).toBe(1500);
    expect(computeDealDiscountCents(1000, 'fixed', null, 1500)).toBe(1000); // never exceeds subtotal
  });
  it('never negative and zero on empty subtotal', () => {
    expect(computeDealDiscountCents(0, 'percent', 50, null)).toBe(0);
    expect(computeDealDiscountCents(-100, 'fixed', null, 500)).toBe(0);
  });
});

describe('resolveStacking', () => {
  it('non-stackable deal is blocked when another discount is applied', () => {
    expect(resolveStacking(false, true).allowed).toBe(false);
  });
  it('stackable deal, or no other discount, is allowed', () => {
    expect(resolveStacking(true, true).allowed).toBe(true);
    expect(resolveStacking(false, false).allowed).toBe(true);
  });
});
