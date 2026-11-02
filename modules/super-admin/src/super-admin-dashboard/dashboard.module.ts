// dashboard.module.ts — wires the Super-Admin dashboard controller + service. Kysely adapter when a DB handle exists
// (staged — see runbook §8), else an empty in-memory adapter (zeros, never fabricated).
import { Module } from '@nestjs/common';
import { SuperAdminDashboardController } from './dashboard.controller';
import { SuperAdminDashboardService } from './dashboard.service';
import { InMemoryDashboardRepository, type DashboardDataPort } from './dashboard.repository';
import { KyselyDashboardRepository } from './dashboard.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminDashboardController],
  providers: [
    { provide: 'DashboardDataPort', useFactory: (db: AppDatabase): DashboardDataPort => (db ? new KyselyDashboardRepository(db) : new InMemoryDashboardRepository()), inject: [DATABASE_READ] },
    { provide: SuperAdminDashboardService, useFactory: (repo: DashboardDataPort) => new SuperAdminDashboardService(repo), inject: ['DashboardDataPort'] },
  ],
  exports: [SuperAdminDashboardService],
})
export class SuperAdminDashboardModule {}
