// automation-scheduler.ts — runs the automation execution engine's due time/threshold evaluations on an interval.
// In-process, CJS-safe (no external dep), gated by AUTOMATION_SCHEDULER_CRON_ENABLED (off by default so dev/test/CI
// never tick). Mirrors the AiTrialSweep pattern. An external scheduler can also drive AutomationSchedulerJob.run().
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { AutomationEngineService } from './automation-engine.service';
import type { AutomationMetricsService } from './automation-metrics.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function automationSchedulerCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.AUTOMATION_SCHEDULER_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class AutomationSchedulerJob {
  constructor(private readonly engine: AutomationEngineService, private readonly metrics: AutomationMetricsService) {}
  /** Evaluate all due time/threshold rules, feeding real metrics to threshold rules. Idempotent per scheduled slot. */
  async run(now: Date = new Date()): Promise<{ evaluated: number; fired: number; rolled: number; skipped: number }> {
    return this.engine.runDueEvaluations(now, { metricProvider: this.metrics.provider() });
  }
}

@Injectable()
export class AutomationSchedulerScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AutomationScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly job: AutomationSchedulerJob) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!automationSchedulerCronEnabled()) return;
    void runTick({ jobType: 'automation', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined);
    this.timer = setInterval(() => { void runTick({ jobType: 'automation', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Automation scheduler armed (every 5 minutes).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(): Promise<void> {
    if (this.running) return;   // never overlap
    this.running = true;
    try { const r = await this.job.run(); if (r.fired) this.log.log(`Automation tick: fired ${r.fired}, skipped ${r.skipped} of ${r.evaluated} due.`); }
    catch (e: any) { this.log.error(`Automation tick failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
