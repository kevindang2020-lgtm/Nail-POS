// business-alerts-schedule.job.ts — A2 AI Business Alerts (Nov 5 2026): the background evaluator the page used to say did not
// exist ("rules are evaluated by hand"). Every 5 minutes, the rules due on their own schedule (hourly / daily) are evaluated
// as their creator (BusinessCenter.scheduledSweep), one process at a time (runAsSingleOwner), recorded with source
// 'scheduled'. AI_BUSINESS_ALERTS_SCHEDULE=off stops it.
// AI Business Reports 14 (Nov 12 2026): the same tick also makes the automated daily / weekly / monthly reports that have come
// due (BusinessCenter.reportScheduleSweep) — one background worker, no second scheduler.
import { Injectable, Inject, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { runAsSingleOwner, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { sessionPermissionsForRole } from '@aipowersalon/permissions';
import { BUSINESS_CENTER } from './business-center.controller';
import type { BusinessCenter } from './business-center';
import { BUSINESS_ALERT_INCIDENTS, type BusinessAlertIncidents } from './business-alert-incidents';

// a role's session permissions: the shared rule (moved to @aipowersalon/permissions Nov 10 2026; re-exported for callers)
export { sessionPermissionsForRole };

@Injectable()
export class BusinessAlertsScheduleJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Optional() @Inject(BUSINESS_CENTER) private readonly center: BusinessCenter | null, @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Optional() @Inject(BUSINESS_ALERT_INCIDENTS) private readonly incidents: BusinessAlertIncidents | null = null) {}
  onModuleInit() {
    if (!runsBackgroundJob('report')) return;
    if (!this.center || !this.db || process.env.AI_BUSINESS_ALERTS_SCHEDULE === 'off') return;
    const every = 5 * 60_000;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'ai_business.alerts.schedule', jobClass: 'report', everyMs: every },
        () => runAsSingleOwner(this.db as Kysely<any>, 'ai_business.alerts.schedule', async () => {
          const r = await (this.center as BusinessCenter).scheduledSweep(sessionPermissionsForRole);
          // A2 (Nov 6 2026): wake snoozed incidents, escalate critical ones still open after 30 minutes
          const inc = this.incidents ? await this.incidents.sweep() : { woke: 0, escalated: 0 };
          const reports = await (this.center as BusinessCenter).reportScheduleSweep(sessionPermissionsForRole);
          return { ...r, ...inc, reports };
        }))
        .catch((e) => logException(e, { where: 'ai-business.alerts.schedule.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}
