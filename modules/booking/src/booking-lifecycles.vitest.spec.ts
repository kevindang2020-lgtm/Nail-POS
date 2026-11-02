// BUILD_PLAN Phase 12 round 2 (#27): a replaced phone number is history; SMS delivery callbacks only move forward.
import { describe, it, expect } from 'vitest';
import { CUSTOMER_PHONE, SMS_USAGE_RECORD } from './booking-lifecycles';

describe('booking lifecycles', () => {
  it('customer phones: verify / confirm / replace; a replaced or expired number is never revived', () => {
    expect([CUSTOMER_PHONE.can('pending_verification', 'active_verified'), CUSTOMER_PHONE.can('active_verified', 'replaced'), CUSTOMER_PHONE.can('pending_verification', 'verification_expired')]).toEqual([true, true, true]);
    expect([CUSTOMER_PHONE.can('replaced', 'active_verified'), CUSTOMER_PHONE.can('verification_expired', 'active_verified'), CUSTOMER_PHONE.can('pending_verification', 'replaced')]).toEqual([false, false, false]);
  });
  it('the SMS ledger: forward only, a final state is final', () => {
    expect([SMS_USAGE_RECORD.can('ACCEPTED', 'DELIVERED'), SMS_USAGE_RECORD.can('DELIVERED', 'FAILED'), SMS_USAGE_RECORD.can('FAILED', 'DELIVERED')]).toEqual([true, false, false]);
  });
});
