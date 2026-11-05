// overview-snapshot.scheduler.ts — in-process monthly capture of the Overview KPI snapshot with NO external scheduler
// dependency (CJS-safe), mirroring HardwarePaymentScheduler. Gated by OVERVIEW_SNAPSHOT_CRON_ENABLED (off by default so
// dev/test/CI never write snapshots). Checks every 6h and captures once per calendar month (deduped on 'YYYY-MM'); the
// snapshot upsert is idempotent per month, and ops can still POST /super-admin/overview/snapshot by hand. Each captured
// month becomes the prior-month baseline for next month's KPI trends (Total/Active/Paused/Trial/Pending/Card-Volume).
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SuperAdminOverviewService } from './overview.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Off unless explicitly enabled — keeps dev/test/CI from writing snapshots. */
export function overviewSnapshotCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.OVERVIEW_SNAPSHOT_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Current calendar month as 'YYYY-MM' (UTC) — matches the snapshot row key. */
export function currentSnapshotMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Pure tick body (unit-tested): capture the snapshot, swallow + log errors so a bad tick never crashes the process. */
export async function snapshotTick(
  svc: { captureSnapshot: () => Promise<{ ok: true; captured: boolean }> },
  log?: { log: (m: string) => void; error: (m: string) => void },
): Promise<boolean> {
  try {
    const r = await svc.captureSnapshot();
    log?.log(`Overview snapshot tick: captured=${r.captured}`);
    return r.captured;
  } catch (e: any) {
    log?.error(`Overview snapshot tick failed: ${e?.message ?? e}`);
    return false;
  }
}

@Injectable()
export class OverviewSnapshotScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OverviewSnapshotScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private lastRunMonth?: string;
  constructor(private readonly svc: SuperAdminOverviewService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('report')) return;   // Constitution 13 Phase 8: this process may not run 'report' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!overviewSnapshotCronEnabled()) return;
    void runTick({ jobType: 'overview.snapshot', jobClass: 'report', everyMs: CHECK_INTERVAL_MS }, () => this.maybeRun()).catch(() => undefined); // capture the current month at boot
    this.timer = setInterval(() => { void runTick({ jobType: 'overview.snapshot', jobClass: 'report', everyMs: CHECK_INTERVAL_MS }, () => this.maybeRun()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref(); // never keep the process alive
    this.log.log('Overview snapshot scheduler armed (checks every 6h; captures once per calendar month).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async maybeRun(): Promise<void> {
    const month = currentSnapshotMonth();
    if (this.lastRunMonth === month) return; // already captured this month
    this.lastRunMonth = month;
    await snapshotTick(this.svc, this.log);
  }
}
