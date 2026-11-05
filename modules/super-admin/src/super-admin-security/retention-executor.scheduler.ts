// retention-executor.scheduler.ts — the daily `retention.execute` job (Constitution 1 §57). Hourly tick through runTick
// (single owner across the fleet, job telemetry), fires once per UTC day. RETENTION_EXECUTOR=off stops it, =dry_run
// computes and logs the counts without writing anything; never runs under NODE_ENV=test. Only in a process allowed to run
// 'standard' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES).
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { utcDate } from '@aipowersalon/date-time';
import { RetentionExecutorService } from './retention-executor.service';
import { executorMode } from './retention-executor-core';

const EVERY_MS = 60 * 60_000;

/** One tick: run when today's (UTC) job run has not happened yet. Exported for the tests. */
export async function retentionTick(svc: RetentionExecutorService, mode: 'on' | 'dry_run', now: Date = new Date(), log: Pick<Logger, 'log' | 'warn'> = new Logger('RetentionExecutor')) {
  if (mode === 'on' && (await svc.lastJobRunDay()) === utcDate(now)) return null;
  const r = await svc.run({ dryRun: mode === 'dry_run', trigger: 'job', actorUserId: null });
  const touched = r.results.filter((x) => x.processed || x.held || x.error);
  log.log(`retention ${r.mode}: ${r.results.length} table(s), ${r.results.reduce((a, x) => a + x.processed, 0)} row(s) ${mode === 'dry_run' ? 'eligible' : 'processed'}, ${r.results.reduce((a, x) => a + x.held, 0)} held`);
  for (const x of touched.filter((t) => t.error)) log.warn(`retention ${x.table}: ${x.error}`);
  return r;
}

@Injectable()
export class RetentionExecutorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('RetentionExecutor');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly svc: RetentionExecutorService) {}
  onModuleInit(): void {
    const mode = executorMode();
    if (mode === 'off') return;
    if (!runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs
    this.timer = setInterval(() => { void runTick({ jobType: 'retention.execute', jobClass: 'standard', everyMs: EVERY_MS }, () => this.tick(mode)).catch(() => undefined); }, EVERY_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log(`retention executor armed (${mode}, daily, policy apps/api/db/retention-policy.json)`);
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async tick(mode: 'on' | 'dry_run'): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await retentionTick(this.svc, mode, new Date(), this.log); }
    catch (e: any) { this.log.warn(`retention tick failed: ${e?.message ?? e}`); }
    finally { this.running = false; }
  }
}
