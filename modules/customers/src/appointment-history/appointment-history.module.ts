// appointment-history.module.ts — Appointment History SUNMI guide (Nov 9 2026): the salon-wide read layer over Booking.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AppointmentHistoryCenter } from './appointment-history-center';
import { AppointmentHistoryCenterController, APPOINTMENT_HISTORY_CENTER } from './appointment-history-center.controller';

@Module({
  controllers: [AppointmentHistoryCenterController],
  providers: [{ provide: APPOINTMENT_HISTORY_CENTER, useFactory: (db: AppDatabase) => (db ? new AppointmentHistoryCenter(db) : null), inject: [DATABASE] }],
})
export class AppointmentHistoryModule {}
