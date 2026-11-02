import { Module } from '@nestjs/common';
import { TenantPresetsController } from './tenant-presets.controller';
import { TenantPresetsService } from './tenant-presets.service';
import { KyselyTenantPresetsRepo, InMemoryTenantPresetsRepo, type TenantPresetsRepo } from './tenant-presets.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [TenantPresetsController],
  providers: [
    { provide: 'TenantPresetsRepo', useFactory: (db: AppDatabase): TenantPresetsRepo => (db ? new KyselyTenantPresetsRepo(db) : new InMemoryTenantPresetsRepo()), inject: [DATABASE] },
    { provide: TenantPresetsService, useFactory: (repo: TenantPresetsRepo, db: AppDatabase) => new TenantPresetsService(repo, db || undefined), inject: ['TenantPresetsRepo', DATABASE] },
  ],
  exports: [TenantPresetsService],
})
export class TenantPresetsModule {}
