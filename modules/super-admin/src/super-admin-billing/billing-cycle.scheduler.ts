// billing-cycle.scheduler.ts — in-process background worker that runs the period-end invoice generator, mirroring
// BillingExportScheduler. OFF by default (BILLING_CYCLE_WORKER_ENABLED) so dev/test/CI never auto-bill. When armed it
// runs one cycle pass every hour. Ops can always trigger a pass by hand via POST /super-admin/billing/cycle/run.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SuperAdminBillingCycleService } from './billing-cycle.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function billingCycleWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.BILLING_CYCLE_WORKER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Pure tick body (unit-tested): run one cycle pass; swallow+log errors so a bad tick never crashes the process. */
export async function billingCycleTick(
  svc: { runBillingCycle: (nowMs?: number, limit?: number) => Promise<{ due: number; invoiced: number; cancelled: number; skipped: number; errors: number }> },
  log?: { log: (m: string) => void; error: (m: string) => void },
): Promise<{ due: number; invoiced: number; cancelled: number; skipped: number; errors: number }> {
  try {
    const r = await svc.runBillingCycle();
    if (r.due) log?.log(`Billing cycle tick: due=${r.due} invoiced=${r.invoiced} cancelled=${r.cancelled} skipped=${r.skipped} errors=${r.errors}`);
    return r;
  } catch (err: any) {
    log?.error(`Billing cycle tick failed: ${err?.message ?? err}`);
    return { due: 0, invoiced: 0, cancelled: 0, skipped: 0, errors: 0 };
  }
}

@Injectable()
export class BillingCycleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BillingCycleScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly svc: SuperAdminBillingCycleService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!billingCycleWorkerEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'billing.cycle', jobClass: 'critical', everyMs: CHECK_INTERVAL_MS }, () => this.maybeRun()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Billing cycle worker armed (generates period-end subscription invoices hourly).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async maybeRun(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await billingCycleTick(this.svc, this.log); } finally { this.running = false; }
  }
}
