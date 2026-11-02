// scheduled-reports.scheduler.ts — D5 (Oct 22 2026, Kevin: "use the recommended"; SW-18 / K-04): Super Admin scheduled
// reports actually RUN.
//
// Until now both schedule stores waited for an external cron nobody called: super_admin_scheduled_reports (migration
// 218 — analytics exports and saved reports in csv / xlsx / pdf, run history, its own screen) and the older
// `scheduled_reports` (migration 272 — the Users CSV e-mailed through a notifier, POST /internal/scheduled-reports/run-due).
// The richer store is THE authority: this scheduler runs its runDue() in-process, once an hour, single-owner across the
// fleet (runTick → the scheduler_runs lease), in a process that runs 'report' jobs. The older store is kept — nothing is
// removed — and its due rows are run by the same tick through the platform service when that service is bound, so a
// schedule saved on either screen fires. The internal endpoints stay, for ops.
//
// SCHEDULED_REPORTS_CRON_ENABLED=1 arms it (off by default, like the membership renewals scheduler — dev / CI never
// generate reports on a timer). A tick that finds nothing due does nothing; a schedule that throws is recorded as an
// error run by the service and never stops the others.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { SuperAdminScheduledReportsService } from './super-admin-scheduled-reports.service';

export const SCHEDULED_REPORTS_EVERY_MS = 60 * 60_000;
export function scheduledReportsCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(env.SCHEDULED_REPORTS_CRON_ENABLED ?? '').trim().toLowerCase());
}
/** The older store's runner (super-admin-platform), bound when that module is in the process. */
export interface LegacyScheduledReportsRunner { runDueScheduledReports(): Promise<{ ran: number; results: { id: string; status: string }[] }> }
/** The system actor the runs are audited under — a job, not a person. */
export const SCHEDULED_REPORTS_ACTOR = { userId: undefined, email: 'system:scheduled-reports' } as const;

@Injectable()
export class ScheduledReportsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ScheduledReports');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private readonly reports: SuperAdminScheduledReportsService, private readonly legacy: LegacyScheduledReportsRunner | null = null) {}

  get armed(): boolean { return this.timer !== null; }

  onModuleInit(): void {
    if (!runsBackgroundJob('report') || !scheduledReportsCronEnabled()) return;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'super_admin.scheduled_reports', jobClass: 'report', everyMs: SCHEDULED_REPORTS_EVERY_MS }, () => this.tick()).catch(() => undefined);
    }, SCHEDULED_REPORTS_EVERY_MS);
    this.timer.unref?.();
    this.log.log('Scheduled-reports scheduler armed (due schedules, hourly, single owner).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** One pass: the authority store's due schedules, then the older store's (when its runner is bound). */
  async tick(now: Date = new Date()): Promise<{ due: number; legacyRan: number }> {
    if (this.running) return { due: 0, legacyRan: 0 };
    this.running = true;
    try {
      const r = await this.reports.runDue({ ...SCHEDULED_REPORTS_ACTOR }, now.toISOString());
      let legacyRan = 0;
      if (this.legacy) {
        try { legacyRan = (await this.legacy.runDueScheduledReports()).ran; }
        catch (e: any) { this.log.warn(`legacy scheduled_reports run failed: ${String(e?.message || e)}`); }
      }
      if (r.dueCount || legacyRan) this.log.log(`scheduled reports: ${JSON.stringify({ due: r.dueCount, errors: r.results.filter((x: any) => x.status === 'error').length, legacyRan })}`);
      return { due: r.dueCount, legacyRan };
    } finally { this.running = false; }
  }
}
