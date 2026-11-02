// tenant-warning-dispatch.scheduler.ts — in-process timer (no external dep, CJS-safe) that dispatches pending tenant
// warnings on a short cadence. Gated by TENANT_WARNING_DISPATCH_CRON_ENABLED (off by default). Mirrors the other
// schedulers: setInterval + unref, errors swallowed in the tick. Ops can also POST the internal trigger by hand.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TenantWarningDispatchJob, warningDispatchTick, tenantWarningDispatchEnabled } from './tenant-warning-dispatch.job';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — warnings should go out promptly

@Injectable()
export class TenantWarningDispatchScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TenantWarningDispatchScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly job: TenantWarningDispatchJob) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!tenantWarningDispatchEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'tenant.warning.dispatch', jobClass: 'critical', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref(); // never keep the process alive
    this.log.log('Tenant-warning dispatch scheduler armed (every 5m).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return; // don't overlap a slow batch
    this.running = true;
    try { await warningDispatchTick(this.job, this.log); } finally { this.running = false; }
  }
}
