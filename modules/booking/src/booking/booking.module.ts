import { BookingCheckinEventsModule, BOOKING_CHECKIN_RECORDER, type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import { NotificationsModule, NotificationsService } from '@aipowersalon/communications';
import { AuditModule, AuditService } from '@aipowersalon/audit';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { BookingDepositService } from '../deposits/booking-deposit.service';
import { BookingDepositsModule } from '../deposits/booking-deposits.module';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { InMemoryBookingRepository, type BookingRepositoryPort } from './booking.repository';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { SlotHoldService } from '../customer-booking/booking-slot-hold';
import { KyselyBookingDraftRepo } from './booking-drafts';
import { BookingDraftsController } from './booking-drafts.controller';
import { TECHNICIAN_SKILLS_PORT, type TechnicianSkillsPort, assertEligibilityAuthorityBound } from './technician-skills.port';

@Module({
  imports: [EventsCoreModule, BookingCheckinEventsModule, NotificationsModule, AuditModule, BookingDepositsModule],   // D11: deposits end with the appointment
  controllers: [BookingController, BookingDraftsController],
  providers: [
    { provide: 'BookingRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): BookingRepositoryPort => (db ? new KyselyBookingRepository(db, outbox) : new InMemoryBookingRepository()), inject: [DATABASE, OutboxWriter] },
    // Round 2 H: live booking holds — the engine respects other sessions' holds and converts the booking's own; the
    // Reception Copilot and the AI receptionist place / release exact-slot holds through the same service. Null without a database.
    { provide: SlotHoldService, useFactory: (db: AppDatabase) => (db ? new SlotHoldService(db) : null), inject: [DATABASE] },
    // B-22 (Oct 22 2026): POS booking drafts live on booking_holds (kind 'draft') — a Postgres handle or no drafts (503, never a fake)
    { provide: KyselyBookingDraftRepo, useFactory: (db: AppDatabase) => (db ? new KyselyBookingDraftRepo(db) : null), inject: [DATABASE] },
    // mandate §51/§78: TECHNICIAN_SKILLS_PORT is provided by the (global) workforce eligibility module — the one authority
    { provide: BookingService, useFactory: (repo: BookingRepositoryPort, recorder: BookingCheckinRecorderPort, notifications: NotificationsService, audit: AuditService, realtime: RealtimeEmitter, holds: SlotHoldService | null, skills: TechnicianSkillsPort | null, deposits: BookingDepositService | null) => { assertEligibilityAuthorityBound('BookingModule', repo instanceof KyselyBookingRepository, skills); return new BookingService(repo, recorder, notifications, audit, realtime, holds, skills ?? null, deposits ?? null); }, inject: ['BookingRepositoryPort', { token: BOOKING_CHECKIN_RECORDER, optional: true }, { token: NotificationsService, optional: true }, { token: AuditService, optional: true }, { token: REALTIME, optional: true }, SlotHoldService, { token: TECHNICIAN_SKILLS_PORT, optional: true }, BookingDepositService] },
  ],
  exports: [BookingService, 'BookingRepositoryPort', SlotHoldService],
})
export class BookingModule {}
