// reports.module.ts — POS Reports controller + service + repository. Kysely-backed adapter when a Postgres handle
// exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default). Both reuse the same shared
// pure builders, so the math is identical regardless of data source.
import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { InMemoryReportsRepository, type ReportsRepositoryPort } from './reports.repository';
import { KyselyReportsRepository } from './reports.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [ReportsController],
  providers: [
    { provide: 'ReportsRepositoryPort', useFactory: (db: AppDatabase): ReportsRepositoryPort => (db ? new KyselyReportsRepository(db) : new InMemoryReportsRepository()), inject: [DATABASE_READ] },
    { provide: ReportsService, useFactory: (repo: ReportsRepositoryPort) => new ReportsService(repo), inject: ['ReportsRepositoryPort'] },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
