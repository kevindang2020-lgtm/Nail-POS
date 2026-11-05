// BUILD_PLAN Phase 12 round 2 (#27): the customers lifecycles — a referral is rewarded once, a merged identity never returns.
import { describe, it, expect } from 'vitest';
import { REFERRAL_REDEMPTION, GLOBAL_CUSTOMER, CUSTOMER_LEGAL_HOLD, CUSTOMER_RECON_RUN, CUSTOMER_IDENTITY_CONFLICT } from './customer-lifecycles';

describe('customer lifecycles', () => {
  it('refuse the dangerous moves', () => {
    expect(REFERRAL_REDEMPTION.can('rewarded', 'rewarded')).toBe(false);   // marking it rewarded again re-wrote the reward
    expect(GLOBAL_CUSTOMER.can('merged', 'merged')).toBe(false);
    expect(CUSTOMER_LEGAL_HOLD.can('released', 'released')).toBe(false);
    expect(CUSTOMER_RECON_RUN.can('COMPLETED', 'FAILED')).toBe(false);
    expect(CUSTOMER_IDENTITY_CONFLICT.can('RESOLVED', 'MERGED')).toBe(false);
  });
  it('keep today’s moves', () => {
    expect([REFERRAL_REDEMPTION.can('pending', 'rewarded'), GLOBAL_CUSTOMER.can('active', 'merged'), CUSTOMER_LEGAL_HOLD.can('active', 'released'), CUSTOMER_RECON_RUN.can('RUNNING', 'PARTIAL'), CUSTOMER_IDENTITY_CONFLICT.can('NEW', 'KEEP_SEPARATE'), CUSTOMER_IDENTITY_CONFLICT.can('IGNORED', 'REVIEWING')]).toEqual([true, true, true, true, true, true]);
  });
});
