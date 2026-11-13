// dashboard.module.ts — POS Dashboard controller + service + repository. Kysely repo when a Postgres handle exists
// (REPO_DRIVER=postgres), else the in-memory repo (dev/offline/tests default).
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { InMemoryDashboardRepo, type DashboardRepo } from './dashboard.repository';
import { KyselyDashboardRepo } from './dashboard.kysely.repository';
import { KyselyOverviewRepo } from '../overview/overview.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { TENANT_CACHE } from '@aipowersalon/cache';
import type { TenantCache } from '@aipowersalon/cache';

export const DASHBOARD_REPO = Symbol('DASHBOARD_REPO');

@Module({
  controllers: [DashboardController],
  providers: [
    { provide: DASHBOARD_REPO, useFactory: (db: AppDatabase): DashboardRepo => (db ? new KyselyDashboardRepo(db) : new InMemoryDashboardRepo()), inject: [DATABASE_READ] },
    // Live Operations 04: the Overview board's repository is the authority the KPI checker verifies against (null without a database)
    { provide: DashboardService, useFactory: (repo: DashboardRepo, cache: TenantCache, db: AppDatabase) => new DashboardService(repo, cache, db ? new KyselyOverviewRepo(db) : null), inject: [DASHBOARD_REPO, TENANT_CACHE, DATABASE_READ] },
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
