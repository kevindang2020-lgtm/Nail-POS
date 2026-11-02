// BUILD_PLAN Phase 12 round 2 (#27): checkout's money lifecycles — a succeeded intent is never re-processed (a second
// charge), a confirmed cash payment is final, a void / replaced gift card is never revived, a stock card is sold once.
import { describe, it, expect } from 'vitest';
import { PAYMENT_INTENT, CASH_PAYMENT_CONFIRMATION, PAYMENT_REFUND, MOBILE_PAY_DEVICE, UPSELL_RECOMMENDATION } from './checkout-lifecycles';
import { GIFT_CARD, GIFT_CARD_STOCK } from '@aipowersalon/gift-cards';

describe('checkout lifecycles', () => {
  it('refuse the dangerous moves', () => {
    expect(PAYMENT_INTENT.can('succeeded', 'processing')).toBe(false);
    expect(PAYMENT_INTENT.can('cancelled', 'processing')).toBe(false);
    expect(CASH_PAYMENT_CONFIRMATION.can('confirmed', 'customer_did_not_pay')).toBe(false);
    expect(PAYMENT_REFUND.can('failed', 'refunded')).toBe(false);
    for (const f of ['void', 'replaced', 'refunded', 'canceled']) expect(GIFT_CARD.can(f, 'active'), f).toBe(false);
    expect(GIFT_CARD.can('void', 'void')).toBe(false);
    expect(GIFT_CARD_STOCK.can('activated', 'activated')).toBe(false);
    expect(UPSELL_RECOMMENDATION.can('DISMISSED', 'APPLIED')).toBe(false);
  });
  it('keep today’s moves', () => {
    for (const [f, t] of [['created', 'processing'], ['processing', 'succeeded'], ['failed', 'processing'], ['cash_pending_tech_confirmation', 'cash_confirmed_by_tech'], ['cash_issue_needs_front_desk', 'cancelled']]) expect(PAYMENT_INTENT.can(f, t), `${f}>${t}`).toBe(true);
    for (const [f, t] of [['pending_payment', 'active'], ['active', 'active'], ['partially_redeemed', 'active'], ['redeemed', 'active'], ['lost_stolen', 'replaced'], ['active', 'void']]) expect(GIFT_CARD.can(f, t), `${f}>${t}`).toBe(true);
    // Secure Tap to Pay §18 (M6-3): a revoked phone is never re-activated — a found / replacement phone registers anew
    expect([MOBILE_PAY_DEVICE.can('pending', 'active'), MOBILE_PAY_DEVICE.can('revoked', 'active'), PAYMENT_REFUND.can('reserved', 'refunded')]).toEqual([true, false, true]);
  });
});
