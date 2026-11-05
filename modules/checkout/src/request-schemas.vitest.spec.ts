// BUILD_PLAN Phase 12 (#17): the checkout routes' body validation (money first), route by route on the real
// controllers — the bodies pos-web sends today pass intact, unknown fields are stripped, a bad body is a 400
// VALIDATION_FAILED naming the field, an undeclared tenantId (and a `status` on a money body) is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { CheckoutController, POSCustomerDisplayController } from './checkout/checkout.controller';
import { CashDrawerPosController } from './cash-drawer/cash-drawer.pos.controller';
import { MobileCheckoutController as M } from './mobile-checkout/mobile-checkout.controller';

const C = CheckoutController; const L = '22222222-2222-4222-8222-222222222222';
const CASES: RouteBodyCase[] = [
  { route: 'POST /pos/checkout/tickets/:id/pay/cash', ctl: C, handler: 'payCash', today: [{ amountReceivedCents: 6000 }, { amountReceivedCents: 0 }], bad: [{ amountReceivedCents: 59.99 }, 'amountReceivedCents'] },
  { route: 'POST /pos/checkout/tickets/:id/pay/card', ctl: C, handler: 'payCard', today: [{}, { tipCents: 500, terminalId: 'term-1' }], bad: [{ tipCents: -1 }, 'tipCents'] },
  { route: 'POST /pos/checkout/tickets/:id/pay/gift-card', ctl: C, handler: 'payGift', today: [{ giftCardCode: '6011000000001234', pin: '1234' }, { giftCardCode: 'GC-ABCD' }], bad: [{ giftCardCode: { $ne: null } }, 'giftCardCode'] },
  { route: 'POST /pos/checkout/tickets/:id/pay/split', ctl: C, handler: 'paySplit', today: [{ segments: [{ method: 'cash', amountCents: 2000 }, { method: 'card', amountCents: 4500 }] }], bad: [{ segments: [{ method: 'cash', amountCents: '20' }] }, 'segments[0].amountCents'] },
  { route: 'POST /pos/checkout/tickets/:id/apply-tip', ctl: C, handler: 'tip', today: [{ tipType: 'percent', tipPercent: 20, source: 'front_desk' }, { tipType: 'none', source: 'front_desk' }, { tipType: 'custom', tipAmountCents: 700, source: 'front_desk' }], bad: [{ tipType: 'percent', tipPercent: 250 }, 'tipPercent'] },
  { route: 'POST /pos/checkout/tickets/:id/apply-discount', ctl: C, handler: 'discount', today: [{ discountCents: 1500 }, { discountCents: 0 }], bad: [{ discountCents: '15' }, 'discountCents'] },
  { route: 'POST /pos/checkout/tickets/:id/refund', ctl: C, handler: 'refundTicket', today: [{ reason: 'chipped', amountCents: 2500 }, { reason: 'chipped', amountCents: 2500, serviceLineIds: [L] }], bad: [{ reason: 'x', amountCents: 2500, status: 'REFUNDED' }, 'status'] },
  { route: 'POST /pos/checkout/payments/:id/refund', ctl: C, handler: 'refund', today: [{ reason: 'duplicate', managerPin: '9999', amountCents: 1000 }], bad: [{ reason: 'x', amountCents: -5 }, 'amountCents'] },
  { route: 'POST /pos/checkout/payments/:id/void', ctl: C, handler: 'void', today: [{ reason: 'wrong card', managerPin: '9999' }], bad: [{ reason: ['x'] }, 'reason'] },
  { route: 'POST /pos/checkout/tickets/:id/reopen-service', ctl: C, handler: 'reopen', today: [{ reason: 'missed a nail' }], bad: [{ reason: 'x'.repeat(1001) }, 'reason'] },
  { route: 'POST /pos/checkout/tickets/:id/gift-card-sale', ctl: C, handler: 'giftSale', today: [{ amountCents: 5000 }, { amountCents: 5000, cardNumber: '6011000000001234', pin: '1234', recipient: { name: 'Mai', phone: '6095551234', email: 'm@x.co', message: 'Happy bday' } }], bad: [{ amountCents: 5000, recipient: 'Mai' }, 'recipient'] },
  { route: 'POST /pos/checkout/tickets/:id/gift-card-reload', ctl: C, handler: 'giftReload', today: [{ code: 'GC-1', amountCents: 2500 }], bad: [{ code: 'GC-1', amountCents: 25.5 }, 'amountCents'] },
  { route: 'POST /pos/checkout/gift-cards/lookup', ctl: C, handler: 'giftLookup', today: [{ input: '6011000000001234' }], bad: [{ input: ['x'] }, 'input'] },
  { route: 'POST /pos/checkout/gift-cards/replace', ctl: C, handler: 'giftReplace', today: [{ input: 'GC-1' }], bad: [{ input: {} }, 'input'] },
  { route: 'POST /pos/checkout/tickets/:id/receipt/send-all', ctl: C, handler: 'rcptAll', today: [{ channels: ['sms', 'email'] }], bad: [{ channels: 'sms' }, 'channels'] },
  { route: 'POST /pos/checkout/tickets/:id/send-to-customer-display', ctl: C, handler: 'send', today: [{ stationId: 'Register 1' }, { stationId: null, deviceId: 'dev-1' }], bad: [{ stationId: 5 }, 'stationId'] },
  { route: 'POST /pos/checkout/tickets/:id/move', ctl: C, handler: 'move', today: [{ registerId: L }], bad: [{ registerId: {} }, 'registerId'] },
  { route: 'POST /pos/checkout/tickets/:id/recalculate', ctl: C, handler: 'recalc', today: [{ paymentMethod: 'card' }, {}], bad: [{ paymentMethod: 7 }, 'paymentMethod'] },
  { route: 'POST /pos/checkout/tickets/:id/apply-promotion', ctl: C, handler: 'applyPromotion', today: [{ code: 'FALL10' }], bad: [{ code: [] }, 'code'] },
  { route: 'POST /pos/checkout/tickets/:id/reward-code', ctl: C, handler: 'applyRewardCode', today: [{ code: 'RW-1234' }], bad: [{ code: { a: 1 } }, 'code'] },
  { route: 'PATCH /pos/customer-display/sessions/:id', ctl: POSCustomerDisplayController, handler: 'update', today: [{ state: 'tip', selectedTipCents: 500 }], bad: [{ selectedTipCents: 'lots' }, 'selectedTipCents'] },
  { route: 'POST /pos/cash-drawer/open', ctl: CashDrawerPosController, handler: 'open', today: [{ openingFloatCents: 20000 }, { openingFloatCents: 20000, date: '2026-10-08' }], bad: [{ openingFloatCents: { x: 1 } }, 'openingFloatCents'] },
  { route: 'POST /pos/cash-drawer/reconcile', ctl: CashDrawerPosController, handler: 'reconcile', today: [{ countedCents: 41250, notes: 'short a five', date: '2026-10-08' }], bad: [{ countedCents: 1, status: 'balanced' }, 'status'] },
  { route: 'POST /pos/cash-drawer/movement', ctl: CashDrawerPosController, handler: 'movement', today: [{ direction: 'out', amountCents: 1500, reason: 'supplies', note: 'acetone' }], bad: [{ direction: 'out', amountCents: [15] }, 'amountCents'] },
  { route: 'POST /pos/cash-drawer/movement/void', ctl: CashDrawerPosController, handler: 'voidMovement', today: [{ movementId: L }, { movementId: L, date: '2026-10-08' }], bad: [{ movementId: {} }, 'movementId'] },
  { route: 'POST /mobile-checkout/device/register', ctl: M, handler: 'registerDevice', today: [{ deviceId: 'ios-abc', label: 'iPhone 15', platform: 'ios', osVersion: '18.1', appVersion: '2.4.0', tapToPayCapable: true }], bad: [{ deviceId: { id: 1 } }, 'deviceId'] },
  { route: 'POST /mobile-checkout/tickets/:id/retail', ctl: M, handler: 'addRetail', today: [{ productId: L, quantity: 2 }, { productId: L }], bad: [{ productId: L, quantity: 'two' }, 'quantity'] },
  { route: 'POST /mobile-checkout/tickets/:id/discount', ctl: M, handler: 'applyDiscount', today: [{ discountCents: 500, reason: 'regular' }], bad: [{ discountCents: [5] }, 'discountCents'] },
  { route: 'POST /mobile-checkout/tickets/:id/lock', ctl: M, handler: 'acquireLock', today: [{ sessionId: 's-1', deviceId: 'ios-abc' }], bad: [{ sessionId: {} }, 'sessionId'] },
  { route: 'POST /mobile-checkout/tickets/:id/lock/refresh', ctl: M, handler: 'refreshLock', today: [{ sessionId: 's-1' }], bad: [{ sessionId: [] }, 'sessionId'] },
  { route: 'POST /mobile-checkout/tickets/:id/lock/release', ctl: M, handler: 'releaseLock', today: [{ sessionId: 's-1', reason: 'done' }], bad: [{ sessionId: 's', reason: 5 }, 'reason'] },
  { route: 'POST /mobile-checkout/tickets/:id/proceed-to-payment', ctl: M, handler: 'proceed', today: [{ sessionId: 's-1', deviceId: 'ios-abc', tip: 'p20' }, { sessionId: 's-1', tip: { customCents: 300 }, segments: [{ amountCents: 2000, method: 'card' }, { amountCents: 1000, method: 'cash' }] }, { sessionId: 's-1' }], bad: [{ sessionId: 's', tip: 'p99' }, 'tip'] },
  { route: 'POST /mobile-checkout/tickets/:id/payment-attempts', ctl: M, handler: 'createAttempt', today: [{ sessionId: 's-1', idempotencyKey: 'k-1', amountCents: 4500 }], bad: [{ sessionId: 's', idempotencyKey: 'k', amountCents: {} }, 'amountCents'] },
  { route: 'POST /mobile-checkout/payments/:id/refund', ctl: M, handler: 'refundPayment', today: [{ reason: 'chipped', amountCents: 1000 }, { reason: 'chipped', serviceLineIds: [L], tipRefunded: true }], bad: [{ reason: 'x', amountCents: 10.5 }, 'amountCents'] },
  { route: 'POST /mobile-checkout/tickets/:id/refund', ctl: M, handler: 'refundTicket', today: [{ reason: 'chipped', amountCents: 1000 }], bad: [{ reason: 'x', amountCents: 5, status: 'refunded' }, 'status'] },
  { route: 'POST /mobile-checkout/payments/:id/void', ctl: M, handler: 'voidPayment', today: [{ reason: 'wrong card' }], bad: [{ reason: {} }, 'reason'] },
  { route: 'POST /mobile-checkout/payment-attempts/:key/readiness', ctl: M, handler: 'attemptReadiness', today: [{}, { deviceId: 'ios-abc' }], bad: [{ deviceId: 7 }, 'deviceId'] },
  { route: 'POST /mobile-checkout/payment-attempts/:key/capture-result', ctl: M, handler: 'captureResult', today: [{ outcome: 'approved', processorRef: 'ch_1', authCode: 'A1', brand: 'visa', last4: '4242', capturedAmountCents: 4500 }, { outcome: 'declined' }], bad: [{ outcome: 'approved', capturedAmountCents: '4500' }, 'capturedAmountCents'] },
  { route: 'POST /mobile-checkout/payment-attempts/:key/reconcile', ctl: M, handler: 'reconcile', today: [{ resolution: 'confirmed' }], bad: [{ resolution: ['x'] }, 'resolution'] },
  { route: 'POST /mobile-checkout/tickets/:id/receipt', ctl: M, handler: 'sendReceipt', today: [{ channel: 'sms' }], bad: [{ channel: { c: 1 } }, 'channel'] },
];

describe('checkout — validated bodies, route by route', () => {
  for (const c of CASES) it(c.route, () => expect(routeBodyFailures(c, bodyPipeOf as any)).toEqual([]));
});
