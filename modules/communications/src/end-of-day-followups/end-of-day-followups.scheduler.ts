/**
 * end-of-day-followups.scheduler.ts — the only time-driven piece. Every few minutes it asks the service to generate for
 * any branch whose local time has passed its generation time today (the timezone-aware gate lives in
 * service.runDueBranches, which is clock-injectable and unit-tested directly). Implemented with a plain unref'd
 * setInterval via Nest lifecycle hooks so it needs no extra dependency and never blocks process exit. Disable with
 * FOLLOWUP_SCHEDULER_DISABLED=1 (used in tests/e2e); tune cadence with FOLLOWUP_SCHEDULER_INTERVAL_MS.
 */
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { DailyFollowUpService } from './end-of-day-followups.service';
import { runsBackgroundJob } from '@aipowersalon/config';

@Injectable()
export class DailyFollowUpScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DailyFollowUpScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = Number(process.env.FOLLOWUP_SCHEDULER_INTERVAL_MS || 5 * 60 * 1000);

  constructor(private readonly svc: DailyFollowUpService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.FOLLOWUP_SCHEDULER_DISABLED === '1') return;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 1000) return;
    // Two distinct jobs share one interval; each is instrumented on its own so a failing expiry does not hide
    // behind a healthy dispatch (Constitution 11 §48: never one "workers" number).
    this.timer = setInterval(() => {
      void runTick({ jobType: 'followups.run_due', jobClass: 'critical', everyMs: this.intervalMs }, () => this.svc.runDueBranches(new Date())).catch((e) => this.logger.warn(`runDueBranches failed: ${e?.message ?? e}`));
      void runTick({ jobType: 'followups.expire_stale', jobClass: 'standard', everyMs: this.intervalMs }, () => this.svc.expireStaleTasks(new Date())).catch((e) => this.logger.warn(`expireStaleTasks failed: ${e?.message ?? e}`));
    }, this.intervalMs);
    if (typeof (this.timer as any)?.unref === 'function') (this.timer as any).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
