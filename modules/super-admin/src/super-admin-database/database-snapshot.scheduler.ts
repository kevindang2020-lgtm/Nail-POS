// database-snapshot.scheduler.ts — BUILD_PLAN Phase 10 (agent E): `database.size_snapshot` (Constitution 1 §94 "table
// size / database size / table growth"). PostgreSQL keeps no size history, so every 6 h one process (runTick lease)
// upserts today's row per public table into db_table_size_snapshots; the last run of a UTC day wins, so the 90-day
// series on the Database page has one point per table per day. Purges rows older than 400 days in the same tick.
// Off with DATABASE_SIZE_SNAPSHOT_JOB=off; asks runsBackgroundJob('standard') like every background scheduler.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DatabaseOpsService } from './database.service';

export const SIZE_SNAPSHOT_EVERY_MS = 6 * 60 * 60 * 1000;
export const sizeSnapshotJobEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => String(env.DATABASE_SIZE_SNAPSHOT_JOB ?? '').trim().toLowerCase() !== 'off';

@Injectable()
export class DatabaseSizeSnapshotScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DatabaseSizeSnapshotScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private boot?: ReturnType<typeof setTimeout>;
  constructor(private readonly svc: DatabaseOpsService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!sizeSnapshotJobEnabled()) return;
    this.boot = setTimeout(() => { void runTick({ jobType: 'database.size_snapshot', jobClass: 'standard', everyMs: SIZE_SNAPSHOT_EVERY_MS }, () => this.tick()).catch(() => undefined); }, 30_000);
    this.timer = setInterval(() => { void runTick({ jobType: 'database.size_snapshot', jobClass: 'standard', everyMs: SIZE_SNAPSHOT_EVERY_MS }, () => this.tick()).catch(() => undefined); }, SIZE_SNAPSHOT_EVERY_MS);
    this.boot.unref?.(); this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); if (this.boot) clearTimeout(this.boot); }

  async tick(): Promise<void> {
    const r = await this.svc.takeSizeSnapshot();
    this.log.log(`table size snapshot: ${r.written} tables, ${r.purged} old rows purged`);
  }
}
