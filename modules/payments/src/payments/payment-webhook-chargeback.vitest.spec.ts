import { describe, it, expect } from 'vitest';
import { isChargebackEvent, mapChargebackStatus, CHARGEBACK_RESOLVED, isOnboardingEvent, mapOnboardingStatus } from './payment-webhook.service';

// Chargeback/dispute webhooks land in the `chargebacks` table; the classification below decides open-vs-resolved.
describe('chargeback webhook classification', () => {
  it('recognizes chargeback and dispute event types', () => {
    expect(isChargebackEvent('chargeback.created')).toBe(true);
    expect(isChargebackEvent('charge.dispute.created')).toBe(true);
    expect(isChargebackEvent('DISPUTE_OPENED')).toBe(true);
    expect(isChargebackEvent('settlement.batch')).toBe(false);
    expect(isChargebackEvent('refund.completed')).toBe(false);
  });

  it('maps lifecycle events to the right status', () => {
    expect(mapChargebackStatus('chargeback.created')).toBe('needs_response'); // a new open alert
    expect(mapChargebackStatus('dispute.received')).toBe('needs_response');
    expect(mapChargebackStatus('dispute.under_review')).toBe('under_review');
    expect(mapChargebackStatus('chargeback.represented')).toBe('under_review');
    expect(mapChargebackStatus('chargeback.won')).toBe('won');
    expect(mapChargebackStatus('chargeback.lost')).toBe('lost');
    expect(mapChargebackStatus('dispute.reversed')).toBe('refunded');
    expect(mapChargebackStatus('chargeback.expired')).toBe('expired');
  });

  it('won/lost/refunded/expired are the resolved (non-alert) statuses', () => {
    expect(CHARGEBACK_RESOLVED).toEqual(['won', 'lost', 'refunded', 'expired']);
    // open + needs_response + under_review are the alert-worthy states the KPI counts
    expect(CHARGEBACK_RESOLVED.includes('needs_response')).toBe(false);
    expect(CHARGEBACK_RESOLVED.includes('under_review')).toBe(false);
  });
});

describe('onboarding / underwriting webhook classification', () => {
  it('recognizes application / underwriting / onboarding events', () => {
    expect(isOnboardingEvent('underwriting.approved')).toBe(true);
    expect(isOnboardingEvent('merchant.application.submitted')).toBe(true);
    expect(isOnboardingEvent('onboarding.under_review')).toBe(true);
    expect(isOnboardingEvent('settlement.batch')).toBe(false);
    expect(isOnboardingEvent('chargeback.created')).toBe(false);
  });

  it('maps application lifecycle to the stored onboarding status', () => {
    expect(mapOnboardingStatus('underwriting.approved')).toBe('approved');
    expect(mapOnboardingStatus('application.declined')).toBe('declined');
    expect(mapOnboardingStatus('application.rejected')).toBe('declined');
    expect(mapOnboardingStatus('underwriting.under_review')).toBe('under_review');
    expect(mapOnboardingStatus('application.submitted')).toBe('submitted');
    expect(mapOnboardingStatus('application.note_added')).toBeNull(); // unrelated phase → no change
  });
});
