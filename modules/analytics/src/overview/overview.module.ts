// overview.module.ts — POS Overview controller + service + repository. The repo is the Kysely implementation when a
// Postgres handle is available (REPO_DRIVER=postgres), else the in-memory implementation (dev/offline/tests default).
import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { OverviewBoardController } from './overview-board.controller';
import { OverviewService } from './overview.service';
import { OverviewBoardService } from './overview-board.service';
import { InMemoryOverviewRepo, type OverviewRepo } from './overview.repository';
import { KyselyOverviewRepo } from './overview.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { TENANT_CACHE } from '@aipowersalon/cache';
import type { TenantCache } from '@aipowersalon/cache';

export const OVERVIEW_REPO = Symbol('OVERVIEW_REPO');

@Module({
  controllers: [OverviewController, OverviewBoardController],
  providers: [
    // Overview is a pure read/aggregate surface (dashboards, live board) with no read-after-write, so it reads from
    // the replica handle (DATABASE_READ) — which falls back to the primary when no replica is configured.
    { provide: OVERVIEW_REPO, useFactory: (db: AppDatabase): OverviewRepo => (db ? new KyselyOverviewRepo(db) : new InMemoryOverviewRepo()), inject: [DATABASE_READ] },
    { provide: OverviewService, useFactory: (repo: OverviewRepo, cache: TenantCache) => new OverviewService(repo, cache), inject: [OVERVIEW_REPO, TENANT_CACHE] },
    { provide: OverviewBoardService, useFactory: (db: AppDatabase) => new OverviewBoardService(db), inject: [DATABASE_READ] },
  ],
  exports: [OverviewService],
})
export class OverviewModule {}
