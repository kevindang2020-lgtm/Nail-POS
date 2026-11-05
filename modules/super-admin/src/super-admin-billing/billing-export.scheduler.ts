// billing-export.scheduler.ts — in-process background worker for async accounting exports (no external scheduler
// dependency, CJS-safe), mirroring OverviewSnapshotScheduler. Gated by BILLING_EXPORT_WORKER_ENABLED (off by default so
// dev/test/CI never run it). When armed it processes pending export jobs and sweeps expired download links every 30s.
// Ops can still trigger processing by hand via POST /super-admin/billing/exports/jobs/process.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SuperAdminBillingService } from './billing.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

export function billingExportWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.BILLING_EXPORT_WORKER_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Pure tick body (unit-tested): process pending jobs + expire stale links; swallow+log errors so a bad tick never crashes. */
export async function exportWorkerTick(
  svc: { processPendingExportJobs: (n?: number) => Promise<{ processed: number }>; expireStaleExportJobs: () => Promise<{ expired: number }> },
  log?: { log: (m: string) => void; error: (m: string) => void },
): Promise<{ processed: number; expired: number }> {
  try {
    const p = await svc.processPendingExportJobs(5);
    const e = await svc.expireStaleExportJobs();
    if (p.processed || e.expired) log?.log(`Billing export tick: processed=${p.processed} expired=${e.expired}`);
    return { processed: p.processed, expired: e.expired };
  } catch (err: any) {
    log?.error(`Billing export tick failed: ${err?.message ?? err}`);
    return { processed: 0, expired: 0 };
  }
}

@Injectable()
export class BillingExportScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BillingExportScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly svc: SuperAdminBillingService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('report')) return;   // Constitution 13 Phase 8: this process may not run 'report' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!billingExportWorkerEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'billing.export', jobClass: 'report', everyMs: CHECK_INTERVAL_MS }, () => this.maybeRun()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Billing export worker armed (processes pending jobs + expires links every 30s).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async maybeRun(): Promise<void> {
    if (this.running) return; // never overlap ticks
    this.running = true;
    try { await exportWorkerTick(this.svc, this.log); } finally { this.running = false; }
  }
}
