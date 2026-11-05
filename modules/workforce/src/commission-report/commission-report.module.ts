// commission-report.module.ts — Kysely-backed when Postgres present, else in-memory.
import { Module } from '@nestjs/common';
import { CommissionReportController } from './commission-report.controller';
import { CommissionReportService } from './commission-report.service';
import { InMemoryCommissionReportRepository, type CommissionReportRepositoryPort } from './commission-report.repository';
import { KyselyCommissionReportRepository } from './commission-report.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [CommissionReportController],
  providers: [
    { provide: 'CommissionReportRepositoryPort', useFactory: (db: AppDatabase): CommissionReportRepositoryPort => (db ? new KyselyCommissionReportRepository(db) : new InMemoryCommissionReportRepository()), inject: [DATABASE_READ] },
    { provide: CommissionReportService, useFactory: (repo: CommissionReportRepositoryPort) => new CommissionReportService(repo), inject: ['CommissionReportRepositoryPort'] },
  ],
  exports: [CommissionReportService],
})
export class CommissionReportModule {}
