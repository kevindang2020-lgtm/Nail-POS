// super-admin-scheduled-reports.module.ts — wires scheduled reports. Owns the schedule + runs tables (via an
// in-memory/Kysely repo) and reuses the analytics export + report builder to generate artifacts. No new aggregation.

import { Module } from '@nestjs/common';
import { SuperAdminAnalyticsModule } from '../super-admin-analytics/super-admin-analytics.module';
import { SuperAdminReportBuilderModule } from '../super-admin-report-builder/super-admin-report-builder.module';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminScheduledReportsController } from './super-admin-scheduled-reports.controller';
import { SuperAdminScheduledReportsService } from './super-admin-scheduled-reports.service';
import { InMemorySuperAdminScheduledReportRepo, KyselySuperAdminScheduledReportRepo, type SuperAdminScheduledReportRepo } from './super-admin-scheduled-reports.repository';

@Module({
  imports: [SuperAdminAnalyticsModule, SuperAdminReportBuilderModule],
  controllers: [SuperAdminScheduledReportsController],
  providers: [
    {
      provide: 'SuperAdminScheduledReportRepo',
      useFactory: (db: AppDatabase): SuperAdminScheduledReportRepo => (db ? new KyselySuperAdminScheduledReportRepo(db) : new InMemorySuperAdminScheduledReportRepo()),
      inject: [DATABASE],
    },
    SuperAdminScheduledReportsService,
  ],
  exports: [SuperAdminScheduledReportsService],
})
export class SuperAdminScheduledReportsModule {}
