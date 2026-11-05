// hardware-payment.scheduler.ts — in-process monthly tick with NO external scheduler dependency (CJS-safe). When
// HARDWARE_PAYMENT_CRON_ENABLED is set, it arms a 6-hourly timer that reconciles the month that just closed, once per
// closed month (deduped on the month string). Off by default so dev/test/CI never auto-charge. The tick body lives in
// runMonthlyTick() (unit-tested); idempotent + re-runnable, and ops can still POST /super-admin/hardware-payment/run-monthly.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { HardwarePaymentReconciliationJob, runMonthlyTick, hardwareCronEnabled, previousBillingMonth } from './hardware-payment.reconciliation-job';
import { FiservResidualImportService } from './hardware-payment.residual-import';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

@Injectable()
export class HardwarePaymentScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('HardwarePaymentScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private lastRunMonth?: string;
  constructor(private readonly job: HardwarePaymentReconciliationJob, private readonly residual: FiservResidualImportService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!hardwareCronEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'hardware.payment', jobClass: 'critical', everyMs: CHECK_INTERVAL_MS }, () => this.maybeRun()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref(); // never keep the process alive
    this.log.log('Monthly hardware reconciliation scheduler armed (checks every 6h; runs once per closed month).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async maybeRun(): Promise<void> {
    const month = previousBillingMonth();
    if (this.lastRunMonth === month) return; // already reconciled this closed month
    this.lastRunMonth = month;
    try { if (process.env.FISERV_RESIDUAL_URL) await this.residual.importFromFiserv(month); } catch (e: any) { this.log.error(`Residual pull ${month} failed: ${e?.message ?? e}`); }
    await runMonthlyTick(this.job, this.log);
  }
}
