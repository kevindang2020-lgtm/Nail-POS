// sla-breach-sweep.scheduler.ts — drives SlaBreachSweepJob on an interval. Off unless SLA_BREACH_SWEEP_CRON is
// set, so dev/test/CI never sweep. Kept separate from the job so the pure logic + job stay dependency-light and
// DB-free testable. Mirrors the AI trial-sweep scheduler.
import { runTick } from '@aipowersalon/observability';
import { Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SlaBreachSweepJob, slaBreachSweepCronEnabled, SLA_BREACH_CHECK_INTERVAL_MS } from './sla-breach-sweep';
import { runsBackgroundJob } from '@aipowersalon/config';

export class SlaBreachSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SlaBreachSweepScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly job: SlaBreachSweepJob) {}
  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!slaBreachSweepCronEnabled()) return;
    void runTick({ jobType: 'sla.breach', jobClass: 'critical', everyMs: SLA_BREACH_CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined);
    this.timer = setInterval(() => { void runTick({ jobType: 'sla.breach', jobClass: 'critical', everyMs: SLA_BREACH_CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, SLA_BREACH_CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('SLA first-response breach sweep armed (15m).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try { const r = await this.job.sweep(); if (r.swept) this.log.log(`SLA breach sweep: flagged ${r.swept}/${r.scanned}.`); }
    catch (e: any) { this.log.error(`SLA breach sweep failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
