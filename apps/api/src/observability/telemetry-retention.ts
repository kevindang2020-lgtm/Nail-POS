// telemetry-retention.ts — Constitution 11 §32, §139, §246, §318: the summary tables do not grow forever.
//
// platform_request_metrics_minute (Phase 4) had NO retention: one row per minute × route × status class, kept for
// ever. It is also what the 30-day SLOs read (Phase 15), so its retention IS the SLO window's floor: 35 days — the
// window plus margin for a late query. Health history (Phase 13) is one row per status CHANGE, so it is small; it is
// kept for 400 days for yearly uptime reporting (§390).
//
// Deletes run in bounded batches so a first run against months of backlog cannot hold a long lock or bloat one
// transaction (§318: retention jobs need observability too — this runs through runJob, so its runs, failures and
// cadence are in the job registry and the health aggregator can see it stall).
import { runTick, log } from '@aipowersalon/observability';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';

export const RETENTION = [
  { table: 'platform_request_metrics_minute', column: 'bucket_minute', keepDays: 35 },
  { table: 'system_health_snapshots', column: 'observed_at', keepDays: 400 },
  { table: 'tenant_health_snapshots', column: 'observed_at', keepDays: 90 },   // §344 hourly per salon: a quarter of history
  { table: 'tenant_load_minute', column: 'bucket_minute', keepDays: 35 },     // Phase 11 noisy neighbour: per salon per minute, same window as the route table
  { table: 'branch_health_snapshots', column: 'observed_at', keepDays: 14 },   // Phase 14 B §345: per branch per 15 min — two weeks (≈96 rows / branch / day)
  { table: 'process_heartbeats', column: 'last_seen_at', keepDays: 30 },      // Phase 14 B: one row per process boot — a month of deployment history
] as const;
export const BATCH = 5_000;
export const MAX_BATCHES_PER_RUN = 200;           // 1,000,000 rows per table per run, then continue tomorrow
const EVERY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TelemetryRetention implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.NODE_ENV === 'test' || !this.db) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'telemetry.retention', jobClass: 'standard', everyMs: EVERY_MS }, () => this.run()).catch(() => undefined); }, EVERY_MS);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  /** Returns rows deleted per table. Each table's failure is isolated from the other's. */
  async run(now = new Date()): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of RETENTION) {
      const cutoff = new Date(now.getTime() - r.keepDays * 86_400_000);
      let total = 0;
      try {
        for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
          // ctid batches: a plain DELETE … WHERE <cutoff> on a months-long backlog is one enormous transaction.
          const res = await sql`delete from ${sql.table(r.table)} where ctid in (
                                  select ctid from ${sql.table(r.table)} where ${sql.ref(r.column)} < ${cutoff} limit ${BATCH})`.execute(this.db);
          const n = Number((res as any).numAffectedRows ?? (res as any).numDeletedRows ?? 0);
          total += n;
          if (n < BATCH) break;
        }
      } catch (e) {
        log.error('retention.failed', { table: r.table, error: (e as Error).message });
      }
      out[r.table] = total;
      if (total) log.info('retention.deleted', { table: r.table, rows: total, keepDays: r.keepDays });
    }
    return out;
  }
}
