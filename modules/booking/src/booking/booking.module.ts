import { BookingCheckinEventsModule, BOOKING_CHECKIN_RECORDER, type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import { NotificationsModule, NotificationsService } from '@aipowersalon/communications';
import { AuditModule, AuditService } from '@aipowersalon/audit';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { InMemoryBookingRepository, type BookingRepositoryPort } from './booking.repository';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SlotHoldService } from '../customer-booking/booking-slot-hold';

@Module({
  imports: [EventsCoreModule, BookingCheckinEventsModule, NotificationsModule, AuditModule],
  controllers: [BookingController],
  providers: [
    { provide: 'BookingRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): BookingRepositoryPort => (db ? new KyselyBookingRepository(db, outbox) : new InMemoryBookingRepository()), inject: [DATABASE, OutboxWriter] },
    // Round 2 H: live booking holds — the engine respects other sessions' holds and converts the booking's own; the
    // Reception Copilot and the AI receptionist place / release exact-slot holds through the same service. Null without a database.
    { provide: SlotHoldService, useFactory: (db: AppDatabase) => (db ? new SlotHoldService(db) : null), inject: [DATABASE] },
    { provide: BookingService, useFactory: (repo: BookingRepositoryPort, recorder: BookingCheckinRecorderPort, notifications: NotificationsService, audit: AuditService, realtime: RealtimeEmitter, holds: SlotHoldService | null) => new BookingService(repo, recorder, notifications, audit, realtime, holds), inject: ['BookingRepositoryPort', { token: BOOKING_CHECKIN_RECORDER, optional: true }, { token: NotificationsService, optional: true }, { token: AuditService, optional: true }, { token: REALTIME, optional: true }, SlotHoldService] },
  ],
  exports: [BookingService, 'BookingRepositoryPort', SlotHoldService],
})
export class BookingModule {}
