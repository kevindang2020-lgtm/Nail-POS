// tenant-navigation.module.ts — tenant POS sidebar support (navigation access, live badges, system status).
import { Module } from '@nestjs/common';
import { TenantNavigationController } from './tenant-navigation.controller';
import { TenantNavigationService } from './tenant-navigation.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [TenantNavigationController],
  providers: [{ provide: TenantNavigationService, useFactory: (db: AppDatabase) => new TenantNavigationService(db), inject: [DATABASE] }],
})
export class TenantNavigationModule {}
