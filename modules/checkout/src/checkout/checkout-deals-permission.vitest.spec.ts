// checkout-deals-permission — BUILD_PLAN Phase 5, bug 2: the people who run checkout could not put a deal or a coupon on
// a ticket. The routes asked for pos.checkout.apply_discount, which collapses to checkout.manage_overrides (owners and
// managers): a receptionist got 403 and the POS swallowed it, so the customer silently paid full price. Deals and
// coupons now ride their own key, deals.apply, which the front desk holds; a MANUAL discount stays a manager decision.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { hasPermission, permissionsFor, requiredCapability } from '@aipowersalon/permissions';
import { CheckoutController } from './checkout.controller';

const ctxFor = (role: any) => ({ tenantId: 't', branchId: 'b', userId: 'u', role, permissions: permissionsFor(role) as string[] }) as any;
const routeKey = (m: string) => Reflect.getMetadata('perm', (CheckoutController.prototype as any)[m]) as string;

describe('who may apply deals and coupons at checkout', () => {
  it('pos.deals.apply maps to the deals.apply capability', () => {
    expect(requiredCapability('pos.deals.apply')).toBe('deals.apply');
  });
  it.each(['applyDeal', 'applyPromotion'])('the %s route asks for pos.deals.apply', (m) => {
    expect(routeKey(m)).toBe('pos.deals.apply');
  });
  it.each(['RECEPTION', 'FRONT_DESK', 'MANAGER', 'OWNER'])('%s can apply a deal or a coupon', (role) => {
    expect(hasPermission(ctxFor(role), routeKey('applyDeal'))).toBe(true);
    expect(hasPermission(ctxFor(role), routeKey('applyPromotion'))).toBe(true);
  });
  it('a technician cannot', () => {
    expect(hasPermission(ctxFor('TECHNICIAN'), 'pos.deals.apply')).toBe(false);
  });
  it('a manual discount is still a manager decision (reception 403)', () => {
    expect(routeKey('discount')).toBe('pos.checkout.apply_discount');
    expect(hasPermission(ctxFor('RECEPTION'), 'pos.checkout.apply_discount')).toBe(false);
    expect(hasPermission(ctxFor('MANAGER'), 'pos.checkout.apply_discount')).toBe(true);
  });
});
