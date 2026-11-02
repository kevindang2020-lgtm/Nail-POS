import { describe, it, expect } from 'vitest';
import { InMemoryAiSubscriptionBillingRepo } from './ai-subscription-billing.repository';
import { AiSubscriptionBillingService } from './ai-subscription-billing.service';
import { AiTrialSweepJob, trialExpiryEventId, aiTrialSweepCronEnabled } from './ai-trial-sweep';

const past = '2025-01-01T00:00:00.000Z';
const future = '2999-01-01T00:00:00.000Z';
const now = '2026-01-01T00:00:00.000Z';

function setup() {
  const repo = new InMemoryAiSubscriptionBillingRepo();
  const svc = new AiSubscriptionBillingService(repo, null);
  const job = new AiTrialSweepJob(repo, svc);
  return { repo, svc, job };
}

describe('AiTrialSweepJob', () => {
  it('flips a lapsed trial to expired and leaves a current trial alone', async () => {
    const { repo, job } = setup();
    repo.subs.set('t1:ai_booking_assistant', 'trialing');
    repo.subs.set('t2:ai_business_assistant', 'trialing');
    repo.trials = [
      { tenantId: 't1', packageCode: 'ai_booking_assistant', trialEndsAt: past },   // lapsed
      { tenantId: 't2', packageCode: 'ai_business_assistant', trialEndsAt: future }, // still active
    ];
    const r = await job.sweep(now);
    expect(r).toMatchObject({ scanned: 1, swept: 1 });
    expect(repo.subs.get('t1:ai_booking_assistant')).toBe('expired');
    expect(repo.subs.get('t2:ai_business_assistant')).toBe('trialing');
  });

  it('is idempotent — a second sweep does nothing', async () => {
    const { repo, job } = setup();
    repo.subs.set('t1:ai_booking_assistant', 'trialing');
    repo.trials = [{ tenantId: 't1', packageCode: 'ai_booking_assistant', trialEndsAt: past }];
    expect((await job.sweep(now)).swept).toBe(1);
    // status is now 'expired' so it's no longer listed; even if re-listed, the event id dedupes.
    expect((await job.sweep(now)).swept).toBe(0);
  });

  it('builds a stable per-trial event id and is gated off by default', () => {
    expect(trialExpiryEventId('t1', 'ai_booking_assistant', past)).toBe('trial_expiry:t1:ai_booking_assistant:2025-01-01');
    expect(aiTrialSweepCronEnabled({} as any)).toBe(false);
    expect(aiTrialSweepCronEnabled({ AI_TRIAL_SWEEP_CRON_ENABLED: 'true' } as any)).toBe(true);
  });
});
