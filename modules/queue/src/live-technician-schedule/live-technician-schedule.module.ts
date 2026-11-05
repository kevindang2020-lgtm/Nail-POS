import { Module } from '@nestjs/common';
import { LiveTechnicianScheduleController } from './live-technician-schedule.controller';
import { LiveTechnicianScheduleService } from './live-technician-schedule.service';
import { InMemoryLiveScheduleRepository, type LiveScheduleRepositoryPort } from './live-technician-schedule.repository';
import { KyselyLiveScheduleRepository } from './live-technician-schedule.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TimeClockModule, TimeClockService, TechnicianEligibilityModule, TechnicianEligibilityService } from '@aipowersalon/workforce';

@Module({
  // Merge Oct 12 2026: breaks go through the time clock (technician_breaks + workforce state); eligibility guards "book this
  // open slot". TimeClockModule does not import this module (no cycle).
  imports: [TimeClockModule, TechnicianEligibilityModule],
  controllers: [LiveTechnicianScheduleController],
  providers: [
    { provide: 'LiveScheduleRepositoryPort', useFactory: (db: AppDatabase): LiveScheduleRepositoryPort => (db ? new KyselyLiveScheduleRepository(db) : new InMemoryLiveScheduleRepository()), inject: [DATABASE] },
    { provide: LiveTechnicianScheduleService, useFactory: (repo: LiveScheduleRepositoryPort, db: AppDatabase, tc?: TimeClockService, eligibility?: TechnicianEligibilityService | null) => new LiveTechnicianScheduleService(repo, db ? tc ?? null : null, eligibility ?? null), inject: ['LiveScheduleRepositoryPort', DATABASE, { token: TimeClockService, optional: true }, { token: TechnicianEligibilityService, optional: true }] },
  ],
  exports: [LiveTechnicianScheduleService],
})
export class LiveTechnicianScheduleModule {}
