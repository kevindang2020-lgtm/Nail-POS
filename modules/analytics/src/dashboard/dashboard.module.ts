// dashboard.module.ts — POS Dashboard controller + service + repository. Kysely repo when a Postgres handle exists
// (REPO_DRIVER=postgres), else the in-memory repo (dev/offline/tests default).
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InMemoryDashboardRepo, type DashboardRepo } from './dashboard.repository';
import { KyselyDashboardRepo } from './dashboard.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { TENANT_CACHE } from '@aipowersalon/cache';
import type { TenantCache } from '@aipowersalon/cache';

export const DASHBOARD_REPO = Symbol('DASHBOARD_REPO');

@Module({
  controllers: [DashboardController],
  providers: [
    { provide: DASHBOARD_REPO, useFactory: (db: AppDatabase): DashboardRepo => (db ? new KyselyDashboardRepo(db) : new InMemoryDashboardRepo()), inject: [DATABASE_READ] },
    { provide: DashboardService, useFactory: (repo: DashboardRepo, cache: TenantCache) => new DashboardService(repo, cache), inject: [DASHBOARD_REPO, TENANT_CACHE] },
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
