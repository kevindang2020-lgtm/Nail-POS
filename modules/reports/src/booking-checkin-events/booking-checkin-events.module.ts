// booking-checkin-events.module.ts — provides the WRITER seam (BookingCheckinRecorder) for the booking/check-in
// pipeline. Exported under a token so any pipeline module can inject it optionally without a hard dependency.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { BOOKING_CHECKIN_RECORDER, BookingCheckinRecorder } from './booking-checkin-recorder';

@Module({
  providers: [
    { provide: BOOKING_CHECKIN_RECORDER, useFactory: (db: AppDatabase) => new BookingCheckinRecorder(db as any), inject: [DATABASE] },
  ],
  exports: [BOOKING_CHECKIN_RECORDER],
})
export class BookingCheckinEventsModule {}
