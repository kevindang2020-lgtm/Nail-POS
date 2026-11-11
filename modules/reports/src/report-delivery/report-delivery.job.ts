// report-delivery.job.ts — the Daily Summary e-mail schedule. Hourly, one process at a time (runAsSingleOwner), every active
// schedule whose salon-local send hour has passed on a send day is sent once (occurrence key). REPORT_EMAIL_SCHEDULE=off stops
// it. Without an e-mail provider the attempt is recorded as simulated (development) or not_configured (production) — never "sent".
import { Injectable, Inject, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { runAsSingleOwner, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { sessionPermissionsForRole } from '@aipowersalon/permissions';
import { REPORT_DELIVERY } from './report-delivery.controller';
import type { ReportDeliveryService } from './report-delivery.service';

export const REPORT_EMAIL_EVERY_MS = 60 * 60_000;
export const reportEmailScheduleOn = (env: NodeJS.ProcessEnv = process.env) => String(env.REPORT_EMAIL_SCHEDULE ?? '').trim().toLowerCase() !== 'off';

@Injectable()
export class ReportDeliveryJob implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(@Optional() @Inject(REPORT_DELIVERY) private readonly svc: ReportDeliveryService | null, @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null) {}
  /** what the screen says: is anything going to send my schedule? */
  running(): boolean { return this.timer != null; }
  onModuleInit() {
    if (!runsBackgroundJob('report') || !this.svc || !this.db || !reportEmailScheduleOn()) return;
    this.timer = setInterval(() => {
      void runTick({ jobType: 'reports.daily_summary.email', jobClass: 'report', everyMs: REPORT_EMAIL_EVERY_MS },
        () => runAsSingleOwner(this.db as Kysely<any>, 'reports.daily_summary.email', () => (this.svc as ReportDeliveryService).tick(sessionPermissionsForRole)))
        .catch((e) => logException(e, { where: 'reports.daily_summary.email.tick' }));
    }, REPORT_EMAIL_EVERY_MS);
    this.timer.unref?.();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
