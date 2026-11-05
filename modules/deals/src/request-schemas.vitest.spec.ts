// BUILD_PLAN Phase 12 (#17): the deals module's body validation, route by route on the real controllers — the bodies
// pos-web (DealWizard toBody, DealCouponsPanel, bundles, salon promotions), owner-web, tech-web and customer-web send
// today pass intact, unknown fields are stripped, a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared
// tenantId (and a `status` on a deal body) is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { DealsController as D } from './deals/deals.controller';
import { DealsCustomerController as DC } from './deals/deals.customer.controller';
import { DealsOwnerController as DO } from './deals/deals.owner.controller';
import { DealsSuperAdminController as DS } from './deals/deals.super-admin.controller';
import { DealsTechController as DT } from './deals/deals.tech.controller';
import { BundlesController as B } from './bundles/bundles.controller';
import { PromotionsController as P } from './promotions/promotions.controller';
import { SalonPromotionsController as SP } from './salon-promotions/salon-promotions.controller';

const I = '22222222-2222-4222-8222-222222222222';
const wizard = { kind: 'deal', title: 'Fall gel', shortDescription: null, terms: null, discountType: 'percent', serviceIds: [I], stackable: false, stackGroup: null, priority: 100, startsAt: '2026-10-08T07:00:00.000Z', endsAt: null, daysOfWeek: null, validFromMinute: null, validToMinute: null, newCustomersOnly: false, memberOnly: false, minSpendCents: null, maxRedemptions: 50, maxPerCustomer: 1, budgetCents: null, bookingLeadMinutes: null, channels: ['pos', 'online'], maxDiscountCents: null, rules: { all: [{ type: 'min_spend', cents: 3000 }] }, discountPercent: 15 };
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string]): RouteBodyCase => ({ route, ctl, handler, today, bad });
const CASES: RouteBodyCase[] = [
  c('POST /pos/deals', D, 'create', [wizard, { ...wizard, kind: 'coupon', code: 'FALL15' }], [{ ...wizard, status: 'active' }, 'status']),
  c('PATCH /pos/deals/:id', D, 'update', [{ title: 'Fall gel+', discountPercent: 20 }], [{ serviceIds: I }, 'serviceIds']),
  c('POST /pos/deals/preview', D, 'preview', [{ deal: { ...wizard, dealId: I }, sample: { serviceIds: [I], paidVisits: 0, isMember: false, channel: 'pos' } }], [{ deal: wizard, sample: { serviceIds: I } }, 'sample.serviceIds']),
  c('POST /pos/deals/:id/approve', D, 'approve', [{}, { reason: 'looks good' }], [{ reason: { r: 1 } }, 'reason']),
  c('POST /pos/deals/:id/reject', D, 'reject', [{ reason: 'too deep' }], [{ reason: [] }, 'reason']),
  c('POST /pos/deals/:id/coupons/generate', D, 'generate', [{ quantity: 50, prefix: 'FALL', singleUse: true, expiresAt: null }], [{ quantity: 5, singleUse: 'yes' }, 'singleUse']),
  c('POST /pos/deals/:id/coupons/:codeId/revoke', D, 'revoke', [{ reason: 'leaked' }], [{ reason: 1 }, 'reason']),
  c('PATCH /pos/deals/settings', D, 'updateSettings', [{ allowTechnicianDeals: 'with_approval', maxDiscountPercent: 30, dealsEnabled: true }], [{ dealsEnabled: 'on' }, 'dealsEnabled']),
  c('POST /customer/deals/public/:id/estimate', DC, 'publicEstimate', [{ serviceIds: [I] }, { serviceIds: [I], date: '2026-10-09', startTime: '10:00' }], [{ serviceIds: I }, 'serviceIds']),
  c('POST /customer/deals/:id/estimate', DC, 'estimate', [{ serviceIds: [I] }], [{ serviceIds: [I], date: 20261009 }, 'date']),
  c('POST /owner/deals/:id/approve', DO, 'approve', [{}], [{ reason: ['x'] }, 'reason']),
  c('POST /owner/deals/:id/reject', DO, 'reject', [{ reason: 'margin' }], [{ reason: {} }, 'reason']),
  c('POST /super-admin/deals/:id/suspend', DS, 'suspend', [{ reason: 'misleading claim' }], [{ reason: 5 }, 'reason']),
  c('PATCH /super-admin/deals/tenants/:tenantId', DS, 'setTenant', [{ disabled: true, reason: 'abuse' }, { maxActiveDeals: 5 }, { maxActiveDeals: null }], [{ disabled: 'true' }, 'disabled']),
  c('POST /tech/deals', DT, 'create', [{ title: 'My gel deal', discountType: 'percent', discountPercent: 10, serviceIds: [I] }], [{ title: 'x', discountPercent: '10' }, 'discountPercent']),
  c('POST /pos/bundles', B, 'create', [{ name: 'Mani + Pedi', kind: 'package', priceCents: 6500, items: [{ itemType: 'service', refId: I, label: 'Gel mani', quantity: 1, unitPriceCents: 4500 }] }], [{ name: 'x', items: { itemType: 'service' } }, 'items']),
  c('PATCH /pos/bundles/:bundleId', B, 'update', [{ priceCents: 6000, status: 'inactive' }], [{ priceCents: '60' }, 'priceCents']),
  c('POST /promotions/validate', P, 'validate', [{ promotionId: I, customerId: I, eligibleSubtotalCents: 5000 }], [{ promotionId: [I] }, 'promotionId']),
  c('POST /promotions/redeem', P, 'redeem', [{ promotionId: I, customerId: I, ticketId: I, eligibleSubtotalCents: 5000, idempotencyKey: 'k-1' }], [{ promotionId: I, discountCents: 900 }, 'discountCents']),
  c('POST /promotions/redemptions/:id/reverse', P, 'reverse', [{ reason: 'refund' }], [{ reason: [] }, 'reason']),
  c('POST /pos/salon-promotions', SP, 'create', [{ code: 'FALL10', name: 'Fall 10%', discountType: 'percent', minPurchaseCents: 0, discountPercent: 10 }, { code: 'TENOFF', name: '$10 off', discountType: 'fixed', minPurchaseCents: 3000, discountCents: 1000 }], [{ code: 'X', name: 'x', status: 'active' }, 'status']),
  c('POST /pos/salon-promotions/:id/status', SP, 'setStatus', [{ status: 'paused' }], [{ status: ['paused'] }, 'status']),
  c('POST /pos/salon-promotions/redeem', SP, 'redeem', [{ code: 'FALL10', subtotalCents: 5000 }], [{ code: { c: 1 } }, 'code']),
];

describe('deals — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
