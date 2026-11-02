// check-in.module.ts — POS Check-In controller + service + repository. Kysely-backed adapter when a Postgres handle
// exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { TechnicianEligibilityService, assertEligibilityAuthorityBound } from '@aipowersalon/workforce';   // B-82: assign checks the exact service
import { CustomerIdentityModule, CustomerIdentityService } from '@aipowersalon/customers';
import { BookingCheckinEventsModule, BOOKING_CHECKIN_RECORDER, type BookingCheckinRecorderPort } from '@aipowersalon/reports';
import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { InMemoryCheckInRepository, type CheckInRepositoryPort } from './check-in.repository';
import { KyselyCheckInRepository } from './check-in.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';

@Module({
  imports: [EventsCoreModule, BookingCheckinEventsModule, CustomerIdentityModule],   // REALTIME is a global provider (RealtimeModule is app-level)
  controllers: [CheckInController],
  providers: [
    { provide: 'CheckInRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): CheckInRepositoryPort => (db ? new KyselyCheckInRepository(db, outbox) : new InMemoryCheckInRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: CheckInService, useFactory: (repo: CheckInRepositoryPort, recorder: BookingCheckinRecorderPort, identity: CustomerIdentityService, realtime: RealtimeEmitter, eligibility: TechnicianEligibilityService | null) => { assertEligibilityAuthorityBound('CheckInModule', repo instanceof KyselyCheckInRepository, eligibility); const svc = new CheckInService(repo, recorder, identity, realtime); svc.eligibility = eligibility ?? null; return svc; }, inject: ['CheckInRepositoryPort', { token: BOOKING_CHECKIN_RECORDER, optional: true }, CustomerIdentityService, { token: REALTIME, optional: true }, { token: TechnicianEligibilityService, optional: true }] },
  ],
  exports: [CheckInService],
})
export class CheckInModule {}
