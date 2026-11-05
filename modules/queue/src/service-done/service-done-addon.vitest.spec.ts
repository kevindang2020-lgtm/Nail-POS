import { describe, it, expect } from 'vitest';
import { addOnRevenueFromTickets } from './service-done.dto';

const L = (isAddOn: boolean, priceCents: number) => ({ serviceLineId: 'x', serviceName: 'n', priceCents, isAddOn });

describe('addOnRevenueFromTickets', () => {
  it('returns 0 for no tickets', () => {
    expect(addOnRevenueFromTickets([])).toBe(0);
  });

  it('sums only add-on line prices across tickets', () => {
    const tickets = [
      { lines: [L(false, 5500), L(true, 1500)] }, // +1500
      { lines: [L(false, 9000), L(true, 2000)] }, // +2000
      { lines: [L(false, 6000)] },                // +0
      { lines: [] },                              // +0
    ];
    expect(addOnRevenueFromTickets(tickets)).toBe(3500);
  });
});
