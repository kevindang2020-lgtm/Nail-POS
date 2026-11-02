import { Module } from '@nestjs/common';
import { AiReportsController } from './ai-reports.controller';
import { AiReportsService } from './ai-reports.service';
import { InMemoryAiReportsRepository, type AiReportsRepositoryPort } from './ai-reports.repository';
import { KyselyAiReportsRepository } from './ai-reports.kysely.repository';
import { ReportRunController } from './report-run.controller';
import { ReportRunService } from './report-run.service';
import { InMemoryReportRunRepository, type ReportRunRepositoryPort } from './report-run.repository';
import { KyselyReportRunRepository } from './report-run.kysely.repository';
import { ReportScheduleController } from './report-schedule.controller';
import { ReportScheduleService } from './report-schedule.service';
import { InMemoryReportScheduleRepository, type ReportScheduleRepositoryPort } from './report-schedule.repository';
import { KyselyReportScheduleRepository } from './report-schedule.kysely.repository';
import { ReportDeliveryController, ReportDeliveryRetryController } from './report-delivery.controller';
import { ReportDeliveryService } from './report-delivery.service';
import { InMemoryReportDeliveryRepository, type ReportDeliveryRepositoryPort } from './report-delivery.repository';
import { KyselyReportDeliveryRepository } from './report-delivery.kysely.repository';
import { ReportTemplateController, ReportNarrativeController } from './report-template.controller';
import { ReportTemplateService } from './report-template.service';
import { InMemoryReportTemplateRepository, type ReportTemplateRepositoryPort } from './report-template.repository';
import { KyselyReportTemplateRepository } from './report-template.repository';
import { NarrativeModelVersionController, NarrativeCommitController } from './narrative-provenance.controller';
import { NarrativeProvenanceService } from './narrative-provenance.service';
import { InMemoryNarrativeProvenanceRepository, type NarrativeProvenanceRepositoryPort } from './narrative-provenance.repository';
import { KyselyNarrativeProvenanceRepository } from './narrative-provenance.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [AiReportsController, ReportRunController, ReportScheduleController, ReportDeliveryController, ReportDeliveryRetryController, ReportTemplateController, ReportNarrativeController, NarrativeModelVersionController, NarrativeCommitController],
  providers: [
    { provide: 'AiReportsRepositoryPort', useFactory: (db: AppDatabase): AiReportsRepositoryPort => (db ? new KyselyAiReportsRepository(db) : new InMemoryAiReportsRepository()), inject: [DATABASE] },
    { provide: AiReportsService, useFactory: (repo: AiReportsRepositoryPort) => new AiReportsService(repo), inject: ['AiReportsRepositoryPort'] },
    { provide: 'ReportRunRepositoryPort', useFactory: (db: AppDatabase): ReportRunRepositoryPort => (db ? new KyselyReportRunRepository(db) : new InMemoryReportRunRepository()), inject: [DATABASE] },
    { provide: ReportRunService, useFactory: (repo: ReportRunRepositoryPort) => new ReportRunService(repo), inject: ['ReportRunRepositoryPort'] },
    { provide: 'ReportScheduleRepositoryPort', useFactory: (db: AppDatabase): ReportScheduleRepositoryPort => (db ? new KyselyReportScheduleRepository(db) : new InMemoryReportScheduleRepository()), inject: [DATABASE] },
    { provide: ReportScheduleService, useFactory: (repo: ReportScheduleRepositoryPort, runs: ReportRunService) => new ReportScheduleService(repo, runs), inject: ['ReportScheduleRepositoryPort', ReportRunService] },
    { provide: 'ReportDeliveryRepositoryPort', useFactory: (db: AppDatabase): ReportDeliveryRepositoryPort => (db ? new KyselyReportDeliveryRepository(db) : new InMemoryReportDeliveryRepository()), inject: [DATABASE] },
    { provide: ReportDeliveryService, useFactory: (repo: ReportDeliveryRepositoryPort) => new ReportDeliveryService(repo), inject: ['ReportDeliveryRepositoryPort'] },
    { provide: 'ReportTemplateRepositoryPort', useFactory: (db: AppDatabase): ReportTemplateRepositoryPort => (db ? new KyselyReportTemplateRepository(db) : new InMemoryReportTemplateRepository()), inject: [DATABASE] },
    { provide: ReportTemplateService, useFactory: (repo: ReportTemplateRepositoryPort) => new ReportTemplateService(repo), inject: ['ReportTemplateRepositoryPort'] },
    { provide: 'NarrativeProvenanceRepositoryPort', useFactory: (db: AppDatabase): NarrativeProvenanceRepositoryPort => (db ? new KyselyNarrativeProvenanceRepository(db) : new InMemoryNarrativeProvenanceRepository()), inject: [DATABASE] },
    { provide: NarrativeProvenanceService, useFactory: (repo: NarrativeProvenanceRepositoryPort, runs: ReportRunService, templates: ReportTemplateService) => new NarrativeProvenanceService(repo, runs, templates), inject: ['NarrativeProvenanceRepositoryPort', ReportRunService, ReportTemplateService] },
  ],
  exports: [AiReportsService, ReportRunService, ReportScheduleService, ReportDeliveryService, ReportTemplateService, NarrativeProvenanceService],
})
export class AiReportsModule {}
