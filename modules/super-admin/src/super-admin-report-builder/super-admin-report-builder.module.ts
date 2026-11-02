// super-admin-report-builder.module.ts — wires the report builder. Owns one small persistence table
// (saved definitions) via an in-memory/Kysely repo, and reuses SuperAdminAnalyticsService to RUN reports
// from existing aggregates (no duplicated aggregation). DATABASE is optional (in-memory fallback for tests).

import { Module } from '@nestjs/common';
import { SuperAdminAnalyticsModule } from '../super-admin-analytics/super-admin-analytics.module';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminReportBuilderController } from './super-admin-report-builder.controller';
import { SuperAdminReportBuilderService } from './super-admin-report-builder.service';
import { InMemorySuperAdminReportRepo, KyselySuperAdminReportRepo, type SuperAdminReportRepo } from './super-admin-report-builder.repository';

@Module({
  imports: [SuperAdminAnalyticsModule],
  controllers: [SuperAdminReportBuilderController],
  providers: [
    {
      provide: 'SuperAdminReportRepo',
      useFactory: (db: AppDatabase): SuperAdminReportRepo => (db ? new KyselySuperAdminReportRepo(db) : new InMemorySuperAdminReportRepo()),
      inject: [DATABASE],
    },
    SuperAdminReportBuilderService,
  ],
  exports: [SuperAdminReportBuilderService],
})
export class SuperAdminReportBuilderModule {}
