// BUILD_PLAN Phase 12 round 2 (#17): checkout's AI-upsell, Tap-to-Pay onboarding and skip-the-line routes — route by
// route on the real controllers: today's bodies pass intact, unknown fields are stripped, a bad body is a 400
// VALIDATION_FAILED naming the field, an undeclared tenantId (and a client-set amount / status on a payment) is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { AiCheckoutUpsellController as U } from './ai-checkout-upsell/ai-checkout-upsell.controller';
import { TtpOnboardingAdminController as TT } from './mobile-checkout/ttp-onboarding.controller';
import { CustomerSkipLineController as CS } from './skip-line-checkout/customer-skip-line.controller';
import { PosSkipLineSettingsController as PSS, SuperAdminSkipLineSettingsController as ASS } from './skip-line-checkout/skip-line-settings.controller';
import { TechCashConfirmationController as TC } from './skip-line-checkout/tech-cash-confirmation.controller';

const I = '22222222-2222-4222-8222-222222222222';
const ok = { confirm: true, idempotencyKey: 'up-1' };
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string]): RouteBodyCase => ({ route, ctl, handler, today, bad });
const CASES: RouteBodyCase[] = [
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/addons/:addOnId/add', U, 'addAddon', [ok], [{ confirm: true, idempotencyKey: ['k'] }, 'idempotencyKey']),
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/membership/:planId/enroll', U, 'enrollMembership', [ok], [{ confirm: {} }, 'confirm']),
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/loyalty/:rewardId/redeem', U, 'redeemLoyalty', [ok], [{ ...ok, status: 'paid' }, 'status']),
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/promotions/:promotionId/apply', U, 'applyPromotion', [ok], [{ confirm: [true] }, 'confirm']),
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/next-appointment/:serviceId', U, 'nextAppointment', [ok], [{ idempotencyKey: { k: 1 } }, 'idempotencyKey']),
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/dismiss', U, 'dismiss', [{ targetId: I, reason: 'not now' }], [{ targetId: [I] }, 'targetId']),
  c('POST /pos/ai-checkout-upsell/checkout/:checkoutId/feedback', U, 'feedback', [{ recommendationId: I, rating: 'up', reason: 'good fit' }], [{ rating: {} }, 'rating']),
  c('PUT /pos/ai-checkout-upsell/settings/:level', U, 'updateSettings', [{ enabled: true }, { tunables: { maxTotal: 2, addOnsEnabled: true, maxAddedValueCents: 3000 } }], [{ tunables: { maxTotal: 'two' } }, 'tunables.maxTotal']),
  c('POST /super-admin/tap-to-pay/tenants/:tenantId/onboarding', TT, 'set', [{ appleEntitlementStatus: 'approved', commerceHubStatus: 'onboarding', notes: 'MID issued' }], [{ appleEntitlementStatus: ['approved'] }, 'appleEntitlementStatus']),
  c('POST /customer/payments/:invoiceId/start', CS, 'start', [{ method: 'card' }, { method: 'card', tipCents: 500 }], [{ method: 'card', amountCents: 1 }, 'amountCents']),
  c('POST /customer/payments/:invoiceId/confirm', CS, 'confirm', [{ intentId: I, method: 'card', token: '9418594164541111', expiry: '1228' }, { intentId: I, method: 'cash_to_technician' }], [{ intentId: I, tipCents: -5 }, 'tipCents']),
  c('PATCH /pos/settings/skip-line-checkout', PSS, 'update', [{ featureEnabled: true, managerApprovalOverCents: 10000 }], [{ featureEnabled: 'on' }, 'featureEnabled']),
  c('PATCH /super-admin/tenants/:tenantId/skip-line-checkout', ASS, 'update', [{ allowCashToTechnician: false }], [{ managerApprovalOverCents: 1.5 }, 'managerApprovalOverCents']),
  c('POST /tech/tickets/:ticketId/report-cash-not-paid', TC, 'notPaid', [{}, { notes: 'left without paying' }], [{ notes: ['x'] }, 'notes']),
];

describe('checkout (round 2) — validated bodies, route by route', () => {
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
});
