// super-admin-catalog.module.ts — Super Admin service-template catalog. Kysely repo when DATABASE is present, else an
// in-memory stub (honest empty). Mirrors the super-admin-plans module wiring.
import { Module } from '@nestjs/common';
import { ServiceTemplatesController } from './service-templates.controller';
import { ServiceTemplatesService } from './service-templates.service';
import { InMemoryCatalogRepo, type CatalogRepo } from './service-templates.repository';
import { KyselyCatalogRepo } from './service-templates.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [ServiceTemplatesController],
  providers: [
    { provide: 'CatalogRepo', useFactory: (db: AppDatabase): CatalogRepo => (db ? new KyselyCatalogRepo(db) : new InMemoryCatalogRepo()), inject: [DATABASE] },
    { provide: ServiceTemplatesService, useFactory: (repo: CatalogRepo) => new ServiceTemplatesService(repo), inject: ['CatalogRepo'] },
  ],
  exports: [ServiceTemplatesService],
})
export class SuperAdminCatalogModule {}
