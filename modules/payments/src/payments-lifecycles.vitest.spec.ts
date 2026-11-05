// BUILD_PLAN Phase 12 round 2 (#27): the payments lifecycles — today's moves allowed, the dangerous ones refused.
import { describe, it, expect } from 'vitest';
import { PAYMENT, CHARGEBACK, PAYMENT_GATEWAY, MERCHANT_ONBOARDING, INVOICE, RECONCILIATION_EXCEPTION, RECONCILIATION_PERIOD } from './payments-lifecycles';

describe('payments lifecycles', () => {
  it('a payment: in flight → approved / declined / failed; approved → settled / voided / refunded; a late "settled" never rewrites a refunded or voided payment', () => {
    for (const [f, t] of [['processing', 'approved'], ['processing', 'declined'], ['processing', 'failed'], ['approved', 'settled'], ['approved', 'voided'], ['settled', 'refunded'], ['settled', 'partially_refunded'], ['partially_refunded', 'refunded'], ['voided', 'voided']]) expect(PAYMENT.can(f, t), `${f}>${t}`).toBe(true);
    for (const [f, t] of [['refunded', 'settled'], ['voided', 'settled'], ['refunded', 'voided'], ['declined', 'approved'], ['failed', 'settled'], ['partially_refunded', 'settled']]) expect(PAYMENT.can(f, t), `${f}>${t}`).toBe(false);
    expect(PAYMENT.sourcesOf('settled')).not.toContain('refunded');
  });
  it('an invoice: draft → sent → paid; a paid or void invoice is final', () => {
    expect([INVOICE.can('draft', 'sent'), INVOICE.can('sent', 'paid'), INVOICE.can('sent', 'void')]).toEqual([true, true, true]);
    expect([INVOICE.can('paid', 'draft'), INVOICE.can('void', 'sent'), INVOICE.can('paid', 'void')]).toEqual([false, false, false]);
  });
  it('a decided chargeback is not silently re-opened by a late callback; it can be explicitly reopened', () => {
    expect(CHARGEBACK.can('won', 'needs_response')).toBe(false);
    expect(CHARGEBACK.can('won', 'reopened')).toBe(true);
    expect(CHARGEBACK.can('needs_response', 'under_review')).toBe(true);
  });
  it('merchant onboarding: a late "submitted" never demotes an approved merchant; the gateway flag toggles freely', () => {
    expect(MERCHANT_ONBOARDING.can('approved', 'submitted')).toBe(false);
    expect(MERCHANT_ONBOARDING.can('submitted', 'approved')).toBe(true);
    expect(PAYMENT_GATEWAY.can('paused', 'active') && PAYMENT_GATEWAY.can('active', 'disabled')).toBe(true);
  });
  it('reconciliation: the exception table deposit-reconciliation has always enforced, and periods close / reopen', () => {
    expect([RECONCILIATION_EXCEPTION.can('resolved', 'reopened'), RECONCILIATION_EXCEPTION.can('resolved', 'in_review'), RECONCILIATION_PERIOD.can('closed', 'closed')]).toEqual([true, false, false]);
  });
});
