// report-delivery.module.ts — Daily Summary e-mail (batch 9 decision 1). Reuses ReportsService (the Sales Report's figures)
// and the platform e-mail sender (SendGrid when configured; never a mock in production).
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { messagingEmailSenderFromEnv } from '@aipowersalon/notifications';
import { ReportsModule } from '../reports/reports.module';
import { ReportsService } from '../reports/reports.service';
import { ReportDeliveryController, REPORT_DELIVERY } from './report-delivery.controller';
import { ReportDeliveryService } from './report-delivery.service';
import { ReportDeliveryJob, reportEmailScheduleOn } from './report-delivery.job';
import { runsBackgroundJob } from '@aipowersalon/config';

@Module({
  imports: [ReportsModule],
  controllers: [ReportDeliveryController],
  providers: [
    { provide: REPORT_DELIVERY, inject: [DATABASE, ReportsService],
      useFactory: (db: AppDatabase, reports: ReportsService) => (db ? new ReportDeliveryService(db, reports, messagingEmailSenderFromEnv(), () => new Date(),
        () => runsBackgroundJob('report') && reportEmailScheduleOn()) : null) },
    ReportDeliveryJob,
  ],
})
export class ReportDeliveryModule {}
