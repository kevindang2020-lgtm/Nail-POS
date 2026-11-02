// super-admin-revenue-residuals.module.ts — wires the platform Revenue & Residuals read endpoints.
// Factory wiring mirrors the service-templates module: optional DATABASE → Kysely repo.

import { Module } from '@nestjs/common';
import { makePrivateStore } from '@aipowersalon/media';   // B-18: export files to the private object store
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminRevenueResidualsController } from './super-admin-revenue-residuals.controller';
import { SuperAdminRevenueResidualsService } from './super-admin-revenue-residuals.service';
import { KyselyRevenueResidualsRepo } from './super-admin-revenue-residuals.kysely.repository';

@Module({
  controllers: [SuperAdminRevenueResidualsController],
  providers: [
    {
      provide: SuperAdminRevenueResidualsService,
      useFactory: (db: AppDatabase) => new SuperAdminRevenueResidualsService(db ? new KyselyRevenueResidualsRepo(db, makePrivateStore()) : undefined),
      inject: [DATABASE],
    },
  ],
  exports: [SuperAdminRevenueResidualsService],
})
export class SuperAdminRevenueResidualsModule {}
