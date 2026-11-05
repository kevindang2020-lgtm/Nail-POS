// super-admin-booking-checkin.module.ts — wires the read-only platform Booking & Check-In Monitor over the platform DB.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SuperAdminBookingCheckinService } from './super-admin-booking-checkin.service';
import { SuperAdminBookingCheckinKyselyRepository } from './super-admin-booking-checkin.kysely.repository';
import { SuperAdminBookingCheckinController } from './super-admin-booking-checkin.controller';

@Module({
  controllers: [SuperAdminBookingCheckinController],
  providers: [
    {
      provide: SuperAdminBookingCheckinService,
      useFactory: (db: AppDatabase) => new SuperAdminBookingCheckinService(new SuperAdminBookingCheckinKyselyRepository(db as any)),
      inject: [DATABASE],
    },
  ],
  exports: [SuperAdminBookingCheckinService],
})
export class SuperAdminBookingCheckinModule {}
