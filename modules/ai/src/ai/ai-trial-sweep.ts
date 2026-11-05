// ai-trial-sweep.ts — flips trialing subscriptions whose trial has lapsed to 'expired' in storage. The access gate
// already denies a lapsed trial at read-time, but the stored status stays 'trialing' until something moves it; that
// makes Super-Admin trial/active counts and MRR drift. This sweep emits a synthetic, idempotent 'trial_expired' billing
// event per lapsed trial (reusing the same state machine + idempotency + audit), so stored state matches reality.
//
// In-process scheduler with NO external dependency (CJS-safe), gated by AI_TRIAL_SWEEP_CRON_ENABLED (off by default so
// dev/test/CI never sweep). Ops can also POST internal/ai-billing/sweep-trials by hand.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { AiSubscriptionBillingRepo } from './ai-subscription-billing.repository';
import type { AiSubscriptionBillingService } from './ai-subscription-billing.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function aiTrialSweepCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.AI_TRIAL_SWEEP_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Stable per-trial event id so re-running the sweep is a no-op (idempotent on the trial end date). */
export function trialExpiryEventId(tenantId: string, packageCode: string, trialEndsAt: string): string {
  return `trial_expiry:${tenantId}:${packageCode}:${trialEndsAt.slice(0, 10)}`;
}

@Injectable()
export class AiTrialSweepJob {
  constructor(private readonly repo: AiSubscriptionBillingRepo, private readonly svc: AiSubscriptionBillingService) {}
  /** Flip all lapsed trials to expired. Idempotent (synthetic event id) and bounded by limit. */
  async sweep(nowIso: string = new Date().toISOString(), limit = 500): Promise<{ scanned: number; swept: number }> {
    const expired = await this.repo.listExpiredTrials(nowIso, limit);
    let swept = 0;
    for (const e of expired) {
      const res = await this.svc.applyEvent({
        eventId: trialExpiryEventId(e.tenantId, e.packageCode, e.trialEndsAt),
        tenantId: e.tenantId, packageCode: e.packageCode, eventType: 'trial_expired', provider: 'system',
      });
      if (res.applied) swept++;
    }
    return { scanned: expired.length, swept };
  }
}

@Injectable()
export class AiTrialSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AiTrialSweepScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly job: AiTrialSweepJob) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('ai')) return;   // Constitution 13 Phase 8: this process may not run 'ai' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!aiTrialSweepCronEnabled()) return;
    void runTick({ jobType: 'ai.trial', jobClass: 'ai', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined);
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.trial', jobClass: 'ai', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('AI trial-expiry sweep armed (hourly).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try { const r = await this.job.sweep(); if (r.swept) this.log.log(`Trial sweep: ${r.swept}/${r.scanned} expired.`); }
    catch (e: any) { this.log.error(`Trial sweep failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
