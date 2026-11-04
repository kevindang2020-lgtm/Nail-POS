// retention-snapshot.scheduler.ts — CR-01: the `retention.snapshot.day` job handler (always registered when the database
// is) and the nightly scheduler (OFF by default: RETENTION_SNAPSHOTS_CRON_ENABLED=1 turns it on; the process must be
// allowed to run 'standard' jobs). The scheduler only ENQUEUES (one durable, idempotent job per salon per day, staggered
// over 30 minutes); the job queue runs, retries with backoff and dead-letters. Single owner per tick across instances.
import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { registerJobHandler, jobHandlerFor, runAsSingleOwner } from '@aipowersalon/database';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick, logException } from '@aipowersalon/observability';
import { RetentionSnapshotRepository, runRetentionSnapshotJob, RETENTION_SNAPSHOT_JOB } from './retention-snapshots';

export const SNAPSHOT_CHECK_MS = 60 * 60_000;   // hourly; each salon's yesterday is enqueued once (idempotency key)
export function retentionSnapshotsCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.RETENTION_SNAPSHOTS_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export class RetentionSnapshotWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RetentionSnapshotScheduler');
  private timer: ReturnType<typeof setInterval> | null = null; private running = false;
  constructor(private readonly db: Kysely<any> | null) {}
  onModuleInit(): void {
    if (!this.db) return;
    const db = this.db;
    if (!jobHandlerFor(RETENTION_SNAPSHOT_JOB)) registerJobHandler(RETENTION_SNAPSHOT_JOB, (payload) => runRetentionSnapshotJob(db, payload));
    if (!runsBackgroundJob('standard') || !retentionSnapshotsCronEnabled()) return;
    const tick = () => { runTick({ jobType: 'retention.snapshot.nightly', jobClass: 'standard', everyMs: SNAPSHOT_CHECK_MS }, () => this.tick())
      .catch((e) => logException(e, { where: 'retention-snapshot.scheduler.tick' })); };
    tick();
    // the tick runs through runTick in the callback itself (the job-telemetry guard reads the callback)
    this.timer = setInterval(() => { runTick({ jobType: 'retention.snapshot.nightly', jobClass: 'standard', everyMs: SNAPSHOT_CHECK_MS }, () => this.tick())
      .catch((e) => logException(e, { where: 'retention-snapshot.scheduler.tick' })); }, SNAPSHOT_CHECK_MS);
    this.timer.unref?.();
    this.log.log('Retention nightly snapshots armed (hourly check).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async tick(): Promise<number> {
    if (!this.db || this.running) return 0;
    this.running = true;
    try {
      const out = await runAsSingleOwner(this.db, 'retention-snapshots', () => new RetentionSnapshotRepository(this.db!).enqueueNightly());
      if (out.ran && out.result.queued) this.log.log(`Retention snapshots: ${out.result.queued} salon-day(s) queued.`);
      return out.ran ? out.result.queued : 0;
    } finally { this.running = false; }
  }
}
