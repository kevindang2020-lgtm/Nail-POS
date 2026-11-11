// extras (Nov 11 2026) — Redemption to receipt drilldown on Discounts: a paid ticket opens its receipt, an unpaid one Checkout
import { describe, it, expect, vi } from 'vitest';
vi.mock('../api/posDiscountsApi', () => ({ posDiscountsApi: {} }));
import { ticketRoute } from './POSDiscountsScreen';

describe('ticketRoute', () => {
  it('paid ticket → Transactions receipt search; code still on an unpaid ticket → Checkout', () => {
    expect(ticketRoute({ ticketId: 't1', ticketNumber: '1042', status: 'redeemed' }, 't1')).toBe('/tenant/payments/transactions?search=1042');
    expect(ticketRoute({ ticketId: 't1', ticketNumber: '1042', status: 'applied' }, 't1')).toBe('/checkout?ticket=t1');
    expect(ticketRoute(undefined, 't 2')).toBe('/checkout?ticket=t%202');
  });
});
