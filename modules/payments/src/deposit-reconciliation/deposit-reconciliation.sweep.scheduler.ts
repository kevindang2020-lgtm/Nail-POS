// deposit-reconciliation.sweep.scheduler.ts — runs the reconciliation sweep on an interval via Nest lifecycle
// hooks (no extra dependency; never blocks process exit). runTick's lease (migration 518) makes each tick single-owner
// across a multi-node deploy. Env-gated: enable with RECON_SWEEP_ENABLED=1; interval via RECON_SWEEP_INTERVAL_MS.
import { runTick } from '@aipowersalon/observability';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ReconSweepService } from './deposit-reconciliation.sweep.service';
import { runsBackgroundJob } from '@aipowersalon/config';

@Injectable()
export class ReconSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly svc: ReconSweepService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('reconciliation')) return;   // Constitution 13 Phase 8: this process may not run 'reconciliation' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.RECON_SWEEP_ENABLED !== '1') return;   // off by default; opt-in per environment
    const ms = Math.max(60_000, Number(process.env.RECON_SWEEP_INTERVAL_MS) || 15 * 60_000);
    this.timer = setInterval(() => { void runTick({ jobType: 'deposit.reconciliation', jobClass: 'reconciliation', everyMs: ms }, () => this.tick()).catch(() => undefined); }, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async tick(): Promise<{ ran: boolean }> {
    try {
      // Single-owner across the fleet comes from runTick's lease (migration 518); the advisory lock this replaced ran on
      // the READ handle (a replica cannot take it) and held a transaction open for the whole sweep.
      await this.svc.sweepAll();
      return { ran: true };
    } catch { return { ran: false }; }   // never let a sweep failure crash the process
  }
}
