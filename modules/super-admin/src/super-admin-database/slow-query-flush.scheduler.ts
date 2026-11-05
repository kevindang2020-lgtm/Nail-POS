// slow-query-flush.scheduler.ts — BUILD_PLAN Phase 10 (agent E): `database.slow_query_flush` (Constitution 1 §95,
// §111 "slow queries are observable"). The slow-query shapes @aipowersalon/observability records live in a bounded
// in-process table: lost on restart, and per process. Every 5 min THIS process writes the samples it recorded since its
// last flush to db_slow_query_samples (fingerprints only — parameter values never exist in them) and purges rows older
// than 30 days. Process-local by design (each process owns its own samples), so it runs through runJob, not the
// fleet-wide runTick lease, and does not ask runsBackgroundJob — like the metrics flush.
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { recentSlowQueries, runJob, type SlowQueryRecord } from '@aipowersalon/observability';
import { processRole } from '@aipowersalon/config';
import type { KyselyDatabaseOpsRepository } from './database.repository';
import { DatabaseOpsService } from './database.service';

export const SLOW_FLUSH_EVERY_MS = 5 * 60 * 1000;
export const SLOW_QUERY_FLUSHER = 'SlowQueryFlusher';

/** The flush body, unit-tested: samples newer than the watermark, written once; the watermark only moves on success. */
export class SlowQueryFlusher {
  private watermark = 0;
  constructor(private readonly repo: Pick<KyselyDatabaseOpsRepository, 'insertSlowSamples' | 'purgeSlowSamples'> | null, private readonly source: () => SlowQueryRecord[] = recentSlowQueries, private readonly role: () => string | null = () => { try { return processRole(); } catch { return null; } }) {}
  async flush(): Promise<{ written: number }> {
    if (!this.repo) return { written: 0 };
    const fresh = this.source().filter((s) => s.at > this.watermark);
    if (fresh.length) {
      await this.repo.insertSlowSamples(fresh.map((s) => ({ at: s.at, hash: s.hash, fingerprint: s.fingerprint, operation: s.operation, table: s.table, durationMs: s.durationMs, rows: s.rows, requestId: s.requestId, tenantId: s.tenantId })), this.role());
      this.watermark = Math.max(...fresh.map((s) => s.at));
    }
    await this.repo.purgeSlowSamples(DatabaseOpsService.SLOW_SAMPLE_KEEP_DAYS);
    return { written: fresh.length };
  }
}

@Injectable()
export class SlowQueryFlushScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SlowQueryFlushScheduler');
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly flusher: SlowQueryFlusher) {}
  onModuleInit(): void {
    if (String(process.env.DATABASE_SLOW_QUERY_FLUSH ?? '').trim().toLowerCase() === 'off') return;
    this.timer = setInterval(() => { void runJob({ jobType: 'database.slow_query_flush', jobClass: 'standard' }, () => this.flusher.flush()).catch((e) => this.log.warn(`slow-query flush failed: ${e?.message ?? e}`)); }, SLOW_FLUSH_EVERY_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
}
