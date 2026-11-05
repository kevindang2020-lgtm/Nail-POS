// profile.module.ts — current-user profile + avatar self-service.
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { STORAGE_QUOTA, type StorageQuotaPort } from '@aipowersalon/media';

@Module({
  controllers: [ProfileController],
  providers: [
    { provide: ProfileService, useFactory: (db: AppDatabase, quota?: StorageQuotaPort) => new ProfileService(db, quota ?? null), inject: [DATABASE, { token: STORAGE_QUOTA, optional: true }] },
  ],
  exports: [ProfileService],
})
export class ProfileModule {}
