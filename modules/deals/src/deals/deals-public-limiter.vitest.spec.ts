// deals-public-limiter.vitest.spec.ts — BUILD_PLAN Phase 5: the guest deal routes are budgeted per client address and a
// refresh is not a view (each view is a row; anonymous traffic must not be able to inflate it or flood the table).
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { DealsPublicLimiter } from './deals-public-limiter';
import { DealsCustomerController } from './deals.customer.controller';

describe('DealsPublicLimiter', () => {
  it('allows 60 a minute per address, then refuses until the minute turns', () => {
    let t = 0; const l = new DealsPublicLimiter(60, 30 * 60_000, () => t);
    for (let i = 0; i < 60; i++) expect(l.hit('1.2.3.4')).toBe(true);
    expect(l.hit('1.2.3.4')).toBe(false);
    expect(l.hit('5.6.7.8')).toBe(true);           // another address has its own budget
    t = 60_000; expect(l.hit('1.2.3.4')).toBe(true);
  });
  it('a deal page counts once per address per 30 minutes', () => {
    let t = 0; const l = new DealsPublicLimiter(60, 30 * 60_000, () => t);
    expect(l.firstView('a', 'd1')).toBe(true);
    expect(l.firstView('a', 'd1')).toBe(false);
    expect(l.firstView('a', 'd2')).toBe(true);
    expect(l.firstView('b', 'd1')).toBe(true);
    t = 30 * 60_000; expect(l.firstView('a', 'd1')).toBe(true);
  });
});

describe('the guest routes use it', () => {
  const svc = { nearbyDeals: vi.fn(async () => []), publicDeal: vi.fn(async () => ({ id: 'd1' })), publicEstimate: vi.fn(async () => ({})), salonDealsForCustomers: vi.fn(async () => []) } as any;
  it('nearby → 429 past the budget; the page counts a view only the first time', async () => {
    const c = new DealsCustomerController(svc);
    const req = { ip: '9.9.9.9' };
    await c.publicDetail(req, 'd1'); await c.publicDetail(req, 'd1');
    expect(svc.publicDeal.mock.calls.map((x: any[]) => x[1].countView)).toEqual([true, false]);
    for (let i = 0; i < 58; i++) await c.nearby(req, {});
    expect(() => c.nearby(req, {})).toThrow(HttpException);
    try { c.nearby(req, {}); } catch (e: any) { expect(e.getStatus()).toBe(429); }
  });
  it('the signed-in salon list asks for the customer-app channel only', async () => {
    const c = new DealsCustomerController(svc);
    await c.salon({ ctx: { tenantId: 't', userId: 'u' } });
    expect(svc.salonDealsForCustomers).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't' }), 'customer_app');
  });
});
