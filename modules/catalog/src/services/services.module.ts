// services.module.ts — POS Services controller + service + repository. The repository is the Kysely-backed adapter
// when a Postgres handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { InMemoryServicesRepository, type ServicesRepositoryPort } from './services.repository';
import { KyselyServicesRepository } from './services.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TENANT_CACHE } from '@aipowersalon/cache';
import type { TenantCache } from '@aipowersalon/cache';

@Module({
  controllers: [ServicesController],
  providers: [
    { provide: 'ServicesRepositoryPort', useFactory: (db: AppDatabase): ServicesRepositoryPort => (db ? new KyselyServicesRepository(db) : new InMemoryServicesRepository()), inject: [DATABASE] },
    { provide: ServicesService, useFactory: (repo: ServicesRepositoryPort, cache: TenantCache) => new ServicesService(repo, cache), inject: ['ServicesRepositoryPort', TENANT_CACHE] },
  ],
  exports: [ServicesService],
})
export class ServicesModule {}
