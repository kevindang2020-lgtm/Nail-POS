// super-admin-scheduled-reports.module.ts — wires scheduled reports. Owns the schedule + runs tables (via an
// in-memory/Kysely repo) and reuses the analytics export + report builder to generate artifacts. No new aggregation.

import { Module } from '@nestjs/common';
import { SuperAdminAnalyticsModule } from '../super-admin-analytics/super-admin-analytics.module';
import { SuperAdminReportBuilderModule } from '../super-admin-report-builder/super-admin-report-builder.module';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminScheduledReportsController } from './super-admin-scheduled-reports.controller';
import { SuperAdminScheduledReportsService } from './super-admin-scheduled-reports.service';
import { InMemorySuperAdminScheduledReportRepo, KyselySuperAdminScheduledReportRepo, type SuperAdminScheduledReportRepo } from './super-admin-scheduled-reports.repository';
import { ScheduledReportsScheduler } from './scheduled-reports.scheduler';
import { SuperAdminPlatformModule } from '../super-admin-platform/super-admin-platform.module';
import { SuperAdminPlatformService } from '../super-admin-platform/super-admin-platform.service';
import { makePrivateStore } from '@aipowersalon/media';
import { PRIVATE_EXPORT_STORE } from '../export-artifact-store';

@Module({
  // D5 (Oct 22 2026): the platform module brings the OLDER scheduled_reports store's runner, so one scheduler fires both
  imports: [SuperAdminAnalyticsModule, SuperAdminReportBuilderModule, SuperAdminPlatformModule],
  controllers: [SuperAdminScheduledReportsController],
  providers: [
    {
      provide: 'SuperAdminScheduledReportRepo',
      useFactory: (db: AppDatabase): SuperAdminScheduledReportRepo => (db ? new KyselySuperAdminScheduledReportRepo(db) : new InMemorySuperAdminScheduledReportRepo()),
      inject: [DATABASE],
    },
    // B-18 (Oct 22 2026): report files go to the PRIVATE object store (never a public URL); the row keeps the key
    { provide: PRIVATE_EXPORT_STORE, useFactory: () => makePrivateStore() },
    SuperAdminScheduledReportsService,
    // D5: in-process, single-owner, hourly runner of due schedules (SCHEDULED_REPORTS_CRON_ENABLED=1) — both stores
    { provide: ScheduledReportsScheduler, useFactory: (svc: SuperAdminScheduledReportsService, legacy?: SuperAdminPlatformService | null) => new ScheduledReportsScheduler(svc, legacy ?? null), inject: [SuperAdminScheduledReportsService, { token: SuperAdminPlatformService, optional: true }] },
  ],
  exports: [SuperAdminScheduledReportsService],
})
export class SuperAdminScheduledReportsModule {}
