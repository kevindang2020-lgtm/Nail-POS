// BUILD_PLAN Phase 12 round 2 (#27): the customers lifecycles — a referral is rewarded once, a merged identity never returns.
import { describe, it, expect } from 'vitest';
import { REFERRAL_REDEMPTION, GLOBAL_CUSTOMER, CUSTOMER_LEGAL_HOLD, CUSTOMER_RECON_RUN, CUSTOMER_IDENTITY_CONFLICT, RETENTION_SMS_CAMPAIGN, RETENTION_SMS_RECIPIENT, CUSTOMER_RETENTION_SNAPSHOT_RUN } from './customer-lifecycles';

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
  it('retention SMS: a recipient that may have reached the provider is never queued or sent again', () => {
    for (const from of ['submitting', 'sent', 'unknown', 'blocked', 'failed']) expect(RETENTION_SMS_RECIPIENT.can(from, 'queued')).toBe(false);
    for (const from of ['sent', 'unknown', 'blocked', 'failed']) expect(RETENTION_SMS_RECIPIENT.can(from, 'submitting')).toBe(false);
    expect(RETENTION_SMS_RECIPIENT.can('submitting', 'unknown')).toBe(true);
    expect([RETENTION_SMS_RECIPIENT.can('excluded', 'queued'), RETENTION_SMS_RECIPIENT.can('queued', 'submitting'), RETENTION_SMS_RECIPIENT.can('queued', 'blocked'), RETENTION_SMS_RECIPIENT.can('submitting', 'sent')]).toEqual([true, true, true, true]);
    expect(RETENTION_SMS_RECIPIENT.sourcesOf('submitting')).toEqual(['queued']);
  });
  it('retention SMS campaign and snapshot runs: finished stays finished; today\'s moves kept', () => {
    expect(RETENTION_SMS_CAMPAIGN.can('queued', 'draft')).toBe(false);
    expect(RETENTION_SMS_CAMPAIGN.can('completed', 'sending')).toBe(false);
    expect(RETENTION_SMS_CAMPAIGN.can('expired', 'queued')).toBe(false);
    expect([RETENTION_SMS_CAMPAIGN.can('draft', 'queued'), RETENTION_SMS_CAMPAIGN.can('draft', 'expired'), RETENTION_SMS_CAMPAIGN.can('queued', 'sending'), RETENTION_SMS_CAMPAIGN.can('queued', 'failed'), RETENTION_SMS_CAMPAIGN.can('sending', 'partial')]).toEqual([true, true, true, true, true]);
    expect(CUSTOMER_RETENTION_SNAPSHOT_RUN.can('completed', 'running')).toBe(false);
    expect(CUSTOMER_RETENTION_SNAPSHOT_RUN.can('completed', 'failed')).toBe(false);
    expect([CUSTOMER_RETENTION_SNAPSHOT_RUN.can('failed', 'running'), CUSTOMER_RETENTION_SNAPSHOT_RUN.can('running', 'running'), CUSTOMER_RETENTION_SNAPSHOT_RUN.can('running', 'completed')]).toEqual([true, true, true]);
  });
});
