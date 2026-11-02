// menu-insights.module.ts — AI Pricing & Menu Insights. Kysely-backed gather when a Postgres handle exists, else the
// in-memory adapter (dev/offline/tests). Same wiring shape as the Services and Bundles modules.
import { Module } from '@nestjs/common';
import { MenuInsightsController } from './menu-insights.controller';
import { MenuInsightsService } from './menu-insights.service';
import { InMemoryMenuInsightsRepository, type MenuInsightsRepositoryPort } from './menu-insights.repository';
import { KyselyMenuInsightsRepository } from './menu-insights.kysely.repository';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [MenuInsightsController],
  providers: [
    { provide: 'MenuInsightsRepositoryPort', useFactory: (db: AppDatabase): MenuInsightsRepositoryPort => (db ? new KyselyMenuInsightsRepository(db as any) : new InMemoryMenuInsightsRepository()), inject: [DATABASE_READ] },
    { provide: MenuInsightsService, useFactory: (repo: MenuInsightsRepositoryPort) => new MenuInsightsService(repo), inject: ['MenuInsightsRepositoryPort'] },
  ],
  exports: [MenuInsightsService],
})
export class MenuInsightsModule {}
