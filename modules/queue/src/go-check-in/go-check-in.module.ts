// go-check-in.module.ts — wires the Go Check-In kiosk. Kysely adapter when a DB handle exists, else in-memory.
// Imports CheckInModule to REUSE CheckInService (walk-in / appointment arrival / create-customer / technicians) with a
// server-derived kiosk context, rather than duplicating that logic.
import { CheckInModule } from '../check-in/check-in.module';
import { CheckInService } from '../check-in/check-in.service';
import { QueueModule } from '../queue/queue.module';
import { QueueService } from '../queue/queue.service';
import { BookingCheckinEventsModule, BOOKING_CHECKIN_RECORDER, type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import { TechnicianClockPinModule, TechnicianClockPinService, TimeClockModule, TimeClockService } from '@aipowersalon/workforce';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { GoCheckInService } from './go-check-in.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { InMemoryGoCheckInRepository, type GoCheckInDataPort } from './go-check-in.repository';
import { KyselyGoCheckInRepository } from './go-check-in.kysely.repository';
import { GoCheckInPublicController } from './go-check-in.public.controller';
import { GoCheckInAdminController, GoCheckInSettingsController } from './go-check-in.admin.controller';

@Module({
  imports: [CheckInModule, BookingCheckinEventsModule, TechnicianClockPinModule, TimeClockModule, QueueModule],   // QueueModule: alternates / accept-alternate (BUILD_PLAN Phase 6)
  controllers: [GoCheckInPublicController, GoCheckInAdminController, GoCheckInSettingsController],
  providers: [
    { provide: 'GoCheckInDataPort', useFactory: (db: AppDatabase): GoCheckInDataPort => (db ? new KyselyGoCheckInRepository(db) : new InMemoryGoCheckInRepository()), inject: [DATABASE] },
    { provide: GoCheckInService, useFactory: (repo: GoCheckInDataPort, checkIn: CheckInService, rt: RealtimeEmitter, recorder: BookingCheckinRecorderPort, clockPin: TechnicianClockPinService, timeClock: TimeClockService, queue: QueueService) => new GoCheckInService(repo, checkIn, rt, recorder, clockPin, timeClock, queue), inject: ['GoCheckInDataPort', CheckInService, REALTIME, BOOKING_CHECKIN_RECORDER, TechnicianClockPinService, TimeClockService, QueueService] },
  ],
  exports: [GoCheckInService],
})
export class GoCheckInModule {}
