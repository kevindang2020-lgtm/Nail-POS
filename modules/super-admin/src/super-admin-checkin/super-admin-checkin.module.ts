// super-admin-checkin.module.ts — wires the read-only platform kiosk Check-in activity over the platform DB.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminCheckinService } from './super-admin-checkin.service';
import { SuperAdminCheckinKyselyRepository } from './super-admin-checkin.kysely.repository';
import { SuperAdminCheckinController } from './super-admin-checkin.controller';

@Module({
  controllers: [SuperAdminCheckinController],
  providers: [
    {
      provide: SuperAdminCheckinService,
      useFactory: (db: AppDatabase) => new SuperAdminCheckinService(new SuperAdminCheckinKyselyRepository(db as any)),
      inject: [DATABASE],
    },
  ],
  exports: [SuperAdminCheckinService],
})
export class SuperAdminCheckinModule {}
