// customer-import.scheduler.ts — in-process background worker for async customer imports (Scaling Roadmap Phase 3).
// Mirrors BillingExportScheduler: no external scheduler dependency, CJS-safe, gated by CUSTOMER_IMPORT_WORKER_ENABLED
// (off by default so dev/test/CI never run it). When armed it processes queued ('approved') import jobs every 15s so
// approving a large import returns immediately and the actual row-writing happens off the request path — the fix for
// the noisy/blocking bulk-import problem at scale (tens of thousands of customers per job).
//
// Ops can also process by hand via the manual trigger on CustomerImportService.processPendingImportJobs (exposed by a
// controller endpoint if desired). Import is idempotent, so a crashed tick simply re-runs safely.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CustomerImportService } from './customer-import.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 15 * 1000; // 15 seconds

export function customerImportWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.CUSTOMER_IMPORT_WORKER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Pure tick body (unit-tested): process a batch of queued import jobs; swallow+log errors so a bad tick never crashes. */
export async function customerImportWorkerTick(
  svc: { processPendingImportJobs: (n?: number) => Promise<{ processed: number }> },
  log?: { log: (m: string) => void; error: (m: string) => void },
): Promise<{ processed: number }> {
  try {
    const p = await svc.processPendingImportJobs(5);
    if (p.processed) log?.log(`Customer import tick: processed=${p.processed}`);
    return { processed: p.processed };
  } catch (err: any) {
    log?.error(`Customer import tick failed: ${err?.message ?? err}`);
    return { processed: 0 };
  }
}

@Injectable()
export class CustomerImportScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CustomerImportScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly svc: CustomerImportService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('import')) return;   // Constitution 13 Phase 8: this process may not run 'import' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!customerImportWorkerEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'customer.import', jobClass: 'import', everyMs: CHECK_INTERVAL_MS }, () => this.maybeRun()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Customer import worker armed (processes queued import jobs every 15s).');
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async maybeRun(): Promise<void> {
    if (this.running) return; // never overlap ticks
    this.running = true;
    try { await customerImportWorkerTick(this.svc, this.log); }
    finally { this.running = false; }
  }
}
