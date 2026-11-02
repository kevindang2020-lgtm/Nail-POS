import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AutomationService } from './automation.service';
import { AutomationRepository } from './automation.repository';
import { AutomationActionsService } from './automation-actions.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationMetricsService } from './automation-metrics.service';
import { AutomationSchedulerJob, AutomationSchedulerScheduler } from './automation-scheduler';
import { SuperAdminAutomationController } from './super-admin-automation.controller';

@Module({
  controllers: [SuperAdminAutomationController],
  providers: [
    { provide: AutomationService, useFactory: (db: AppDatabase) => new AutomationService(new AutomationRepository(db as any)), inject: [DATABASE] },
    { provide: AutomationActionsService, useFactory: (db: AppDatabase) => new AutomationActionsService(db as never), inject: [DATABASE] },
    { provide: AutomationEngineService, useFactory: (db: AppDatabase) => new AutomationEngineService(db as never), inject: [DATABASE] },
    { provide: AutomationMetricsService, useFactory: (db: AppDatabase) => new AutomationMetricsService(db as never), inject: [DATABASE] },
    { provide: AutomationSchedulerJob, useFactory: (engine: AutomationEngineService, metrics: AutomationMetricsService) => new AutomationSchedulerJob(engine, metrics), inject: [AutomationEngineService, AutomationMetricsService] },
    { provide: AutomationSchedulerScheduler, useFactory: (job: AutomationSchedulerJob) => new AutomationSchedulerScheduler(job), inject: [AutomationSchedulerJob] },
  ],
  exports: [AutomationService, AutomationActionsService, AutomationEngineService, AutomationMetricsService, AutomationSchedulerJob],
})
export class SuperAdminAutomationModule {}
