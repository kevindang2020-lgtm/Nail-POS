// technician-eligibility.module.ts — binds THE ONE eligibility function (technician-eligibility.ts) for every assignment
// path (tech app today; queue / tech-queue / serving / booking / customer booking / check-in / live schedule as they adopt
// it). @Global like WorkforceStatusModule so consumers inject TechnicianEligibilityService without importing this module.
// Merged Oct 12 2026 from the other chat's tech/technician-eligibility.module.ts.
//
// Port bindings (see workforce-status/workforce-ports.ts):
//   WorkforceStatePort — WF's WORKFORCE_STATE_PORT (the REAL WorkforceStatusService through WorkforceStatePortAdapter;
//     fail-closed by construction: no state row → not assignable). Optional here so a test module without
//     WorkforceStatusModule still boots: unbound → the assignability question is skipped (null port), never answered
//     "yes" by a permissive stub.
//   AvailabilityPort  — the schedule engine seam: KyselyAvailabilityPort (availability/availability-port.adapter.ts — weekly
//     schedule, APPROVED time off, blocked time, open live break; BK merge Oct 12 2026) with a database, NoAvailabilityPort
//     without one. Consulted only when a caller passes `at`; appointment overlaps stay the slot guard's job.
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TechnicianEligibilityService, KyselyEligibilityReader } from './technician-eligibility';
import { KyselyAvailabilityPort } from '../availability/availability-port.adapter';
import { NoAvailabilityPort, WORKFORCE_STATE_PORT, type AvailabilityPort, type WorkforceStatePort } from '../workforce-status/workforce-ports';

export const AVAILABILITY_PORT = 'AvailabilityPort';

@Global()
@Module({
  providers: [
    { provide: AVAILABILITY_PORT, useFactory: (db: AppDatabase): AvailabilityPort => (db ? new KyselyAvailabilityPort(db as any) : new NoAvailabilityPort()), inject: [DATABASE] },
    {
      provide: TechnicianEligibilityService,
      // NULL without a database: the in-memory dev repos carry fixture technicians the reader cannot see, so the
      // consuming services keep their legacy in-memory checks. With a DB this is the only eligibility authority.
      useFactory: (db: AppDatabase, workforce: WorkforceStatePort | null, availability: AvailabilityPort): TechnicianEligibilityService | null =>
        db ? new TechnicianEligibilityService({ reader: new KyselyEligibilityReader(db as any), workforce: workforce ?? null, availability }) : null,
      inject: [DATABASE, { token: WORKFORCE_STATE_PORT, optional: true }, AVAILABILITY_PORT],
    },
  ],
  exports: [TechnicianEligibilityService, AVAILABILITY_PORT],
})
export class TechnicianEligibilityModule {}
