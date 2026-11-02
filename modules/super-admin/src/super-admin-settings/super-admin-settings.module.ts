import { Module } from '@nestjs/common';
import { SuperAdminSettingsController } from './super-admin-settings.controller';
import { SuperAdminSettingsService } from './super-admin-settings.service';
import { KyselyPlatformSettingsRepo, InMemoryPlatformSettingsRepo, type PlatformSettingsRepo } from './platform-settings.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminSettingsController],
  providers: [
    { provide: 'PlatformSettingsRepo', useFactory: (db: AppDatabase): PlatformSettingsRepo => (db ? new KyselyPlatformSettingsRepo(db) : new InMemoryPlatformSettingsRepo()), inject: [DATABASE] },
    { provide: SuperAdminSettingsService, useFactory: (repo: PlatformSettingsRepo, db: AppDatabase) => new SuperAdminSettingsService(repo, db || undefined), inject: ['PlatformSettingsRepo', DATABASE] },
  ],
  exports: [SuperAdminSettingsService],
})
export class SuperAdminSettingsModule {}
