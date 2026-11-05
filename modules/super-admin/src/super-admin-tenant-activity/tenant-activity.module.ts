// tenant-activity.module.ts — wires the Tenant Activity read-model. Kysely adapter when a DB handle exists, else in-memory.
import { Module } from '@nestjs/common';
import { SuperAdminTenantActivityController } from './tenant-activity.controller';
import { SuperAdminTenantActivityService } from './tenant-activity.service';
import { InMemoryTenantActivityRepo, type TenantActivityRepo } from './tenant-activity.repository';
import { KyselyTenantActivityRepo } from './tenant-activity.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminTenantActivityController],
  providers: [
    { provide: 'TenantActivityRepo', useFactory: (db: AppDatabase): TenantActivityRepo => (db ? new KyselyTenantActivityRepo(db as any) : new InMemoryTenantActivityRepo()), inject: [DATABASE] },
    { provide: SuperAdminTenantActivityService, useFactory: (repo: TenantActivityRepo) => new SuperAdminTenantActivityService(repo), inject: ['TenantActivityRepo'] },
  ],
  exports: [SuperAdminTenantActivityService],
})
export class SuperAdminTenantActivityModule {}
