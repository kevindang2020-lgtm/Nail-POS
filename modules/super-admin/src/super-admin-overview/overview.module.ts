// overview.module.ts — wires the Super-Admin Overview. Kysely adapter when a DB handle exists, else the in-memory
// adapter (zeros, never fabricated) — same pattern as SuperAdminDashboardModule.
import { Module } from '@nestjs/common';
import { SuperAdminOverviewController } from './overview.controller';
import { SuperAdminOverviewService } from './overview.service';
import { InMemoryOverviewRepository, type OverviewDataPort } from './overview.repository';
import { KyselyOverviewRepository } from './overview.kysely.repository';
import { OverviewSnapshotScheduler } from './overview-snapshot.scheduler';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { DailySummariesScheduler } from './daily-summaries.scheduler';

@Module({
  controllers: [SuperAdminOverviewController],
  providers: [
    { provide: 'OverviewDataPort', useFactory: (db: AppDatabase): OverviewDataPort => (db ? new KyselyOverviewRepository(db as any) : new InMemoryOverviewRepository()), inject: [DATABASE_READ] },
    { provide: SuperAdminOverviewService, useFactory: (repo: OverviewDataPort) => new SuperAdminOverviewService(repo), inject: ['OverviewDataPort'] },
    // Phase 10 (audit bug 2): the hourly summaries.daily writer — the Overview's daily summary tables had no writer
    { provide: DailySummariesScheduler, useFactory: (db: AppDatabase) => new DailySummariesScheduler(db ? (db as any) : null), inject: [DATABASE] },
    { provide: OverviewSnapshotScheduler, useFactory: (svc: SuperAdminOverviewService) => new OverviewSnapshotScheduler(svc), inject: [SuperAdminOverviewService] },
  ],
  exports: [SuperAdminOverviewService, DailySummariesScheduler],
})
export class SuperAdminOverviewModule {}
