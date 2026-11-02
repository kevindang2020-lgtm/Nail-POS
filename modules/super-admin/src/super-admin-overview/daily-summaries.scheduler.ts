// daily-summaries.scheduler.ts — the hourly `summaries.daily` job (BUILD_PLAN Phase 10, audit bug 2): rewrites every
// branch's TODAY and YESTERDAY in tenant_daily_sales/booking/customer_summary (writeDailySummaries upserts, so a re-run
// is harmless). ON by default — the Super Admin Overview reads these tables and showed zero while nothing wrote them —
// except under tests; SUMMARIES_DAILY_CRON_ENABLED=0 turns it off. History: scripts/db-backfill-summaries.mjs.
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { writeDailySummaries, type SummaryWriteResult } from './daily-summaries.writer';

export const SUMMARIES_DAILY_EVERY_MS = 60 * 60 * 1000;

export function summariesDailyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.SUMMARIES_DAILY_CRON_ENABLED ?? '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  return env.NODE_ENV !== 'test' && !env.VITEST;
}

@Injectable()
export class DailySummariesScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DailySummaries');
  private timer: ReturnType<typeof setInterval> | null = null;
  private boot: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  constructor(private readonly db: Kysely<any> | null) {}

  onModuleInit(): void {
    if (!this.db || !runsBackgroundJob('standard')) return;   // Constitution 13 Phase 8: this process may not run 'standard' jobs
    if (!summariesDailyEnabled()) return;
    this.boot = setTimeout(() => { void runTick({ jobType: 'summaries.daily', jobClass: 'standard', everyMs: SUMMARIES_DAILY_EVERY_MS }, () => this.tick()).catch(() => undefined); }, 30_000); this.boot.unref?.();
    this.timer = setInterval(() => { void runTick({ jobType: 'summaries.daily', jobClass: 'standard', everyMs: SUMMARIES_DAILY_EVERY_MS }, () => this.tick()).catch(() => undefined); }, SUMMARIES_DAILY_EVERY_MS); this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); if (this.boot) clearTimeout(this.boot); this.timer = null; this.boot = null; }

  /** One pass over every branch (today + yesterday, local). Public for ops, the live proof and tests. Non-overlapping. */
  async tick(opts: { tenantId?: string } = {}): Promise<SummaryWriteResult> {
    if (!this.db || this.running) return { branches: 0, salesRows: 0, bookingRows: 0, customerRows: 0 };
    this.running = true;
    try { return await writeDailySummaries(this.db, opts); }
    catch (e: any) { this.log.error(`summaries.daily failed: ${e?.message ?? e}`); throw e; }
    finally { this.running = false; }
  }
}
