// tenant-ai.module.ts — wires the tenant-owner AI surface. Kysely repo when a DB handle exists, in-memory otherwise.
import { Module } from '@nestjs/common';
import { TenantAiController } from './tenant-ai.controller';
import { TenantAiService } from './tenant-ai.service';
import { InMemoryTenantAiRepo, KyselyTenantAiRepo, type TenantAiRepo } from './tenant-ai.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [TenantAiController],
  providers: [
    { provide: 'TenantAiRepo', useFactory: (db: AppDatabase): TenantAiRepo => (db ? new KyselyTenantAiRepo(db as any) : new InMemoryTenantAiRepo()), inject: [DATABASE] },
    { provide: TenantAiService, useFactory: (repo: TenantAiRepo, db: AppDatabase) => new TenantAiService(repo, (db as any) ?? null), inject: ['TenantAiRepo', DATABASE] },
  ],
  exports: [TenantAiService],
})
export class TenantAiModule {}
