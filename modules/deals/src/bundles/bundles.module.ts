// bundles.module.ts — POS Bundles controller + service + repository. The repository is the Kysely-backed adapter
// when a Postgres handle exists, else the in-memory adapter (dev/offline/tests default) — identical to the Services module.
import { Module } from '@nestjs/common';
import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';
import { InMemoryBundlesRepository, type BundlesRepositoryPort } from './bundles.repository';
import { KyselyBundlesRepository } from './bundles.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [BundlesController],
  providers: [
    { provide: 'BundlesRepositoryPort', useFactory: (db: AppDatabase): BundlesRepositoryPort => (db ? new KyselyBundlesRepository(db as any) : new InMemoryBundlesRepository()), inject: [DATABASE] },
    { provide: BundlesService, useFactory: (repo: BundlesRepositoryPort) => new BundlesService(repo), inject: ['BundlesRepositoryPort'] },
  ],
  exports: [BundlesService],
})
export class BundlesModule {}
