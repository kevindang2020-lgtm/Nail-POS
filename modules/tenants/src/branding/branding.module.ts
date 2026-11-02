// branding.module.ts — platform branding (public read + locked super-admin controls + audit).
import { Module } from '@nestjs/common';
import { PublicBrandingController, SuperAdminBrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [PublicBrandingController, SuperAdminBrandingController],
  providers: [
    { provide: BrandingService, useFactory: (db: AppDatabase) => new BrandingService(db), inject: [DATABASE] },
  ],
  exports: [BrandingService],
})
export class BrandingModule {}
