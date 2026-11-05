// services.module.ts — POS Services controller + service + repository. The repository is the Kysely-backed adapter
// when a Postgres handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { InMemoryServicesRepository, type ServicesRepositoryPort } from './services.repository';
import { KyselyServicesRepository } from './services.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TENANT_CACHE } from '@aipowersalon/cache';
import { CatalogScreensController, CATALOG_SCREENS } from '../catalog-screens/catalog-screens.controller';
import { CatalogScreensRepository } from '../catalog-screens/catalog-screens.repository';
import { PriceScheduleJob } from '../catalog-screens/price-schedule.job';
import type { TenantCache } from '@aipowersalon/cache';

@Module({
  controllers: [ServicesController, CatalogScreensController],
  providers: [
    { provide: 'ServicesRepositoryPort', useFactory: (db: AppDatabase): ServicesRepositoryPort => (db ? new KyselyServicesRepository(db) : new InMemoryServicesRepository()), inject: [DATABASE] },
    // Services & Products / Categories / Pricing / Add-Ons (Oct 30 2026): the read model + audited catalog writes
    { provide: CATALOG_SCREENS, useFactory: (db: AppDatabase) => (db ? new CatalogScreensRepository(db) : null), inject: [DATABASE] },
    PriceScheduleJob,   // D4 gaps (Nov 5 2026): applies scheduled prices when due
    { provide: ServicesService, useFactory: (repo: ServicesRepositoryPort, cache: TenantCache) => new ServicesService(repo, cache), inject: ['ServicesRepositoryPort', TENANT_CACHE] },
  ],
  exports: [ServicesService],
})
export class ServicesModule {}
