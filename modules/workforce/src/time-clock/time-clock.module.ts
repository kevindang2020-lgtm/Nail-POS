// time-clock.module.ts — Kysely-backed when Postgres present, else in-memory.
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { TimeClockController } from './time-clock.controller';
import { TimeClockService } from './time-clock.service';
import { InMemoryTimeClockRepository, type TimeClockRepositoryPort } from './time-clock.repository';
import { KyselyTimeClockRepository } from './time-clock.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { WorkforceStatusModule } from '../workforce-status/workforce-status.module';
import { WorkforceStatusService } from '../workforce-status/workforce-status.service';

@Module({
  // EventsCoreModule: the outbox writer clock changes are recorded through (§343). WorkforceStatusModule is @Global;
  // importing it here registers it once for the whole app (every clock change moves the ONE workforce state — 579).
  imports: [EventsCoreModule, WorkforceStatusModule],
  controllers: [TimeClockController],
  providers: [
    { provide: 'TimeClockRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): TimeClockRepositoryPort => (db ? new KyselyTimeClockRepository(db, outbox) : new InMemoryTimeClockRepository()), inject: [DATABASE, OutboxWriter] },   // the PRIMARY: this repository writes punches (it was DATABASE_READ — a replica handle)
    { provide: TimeClockService, useFactory: (repo: TimeClockRepositoryPort, rt: RealtimeEmitter, wf?: WorkforceStatusService) => new TimeClockService(repo, rt, wf ?? null), inject: ['TimeClockRepositoryPort', REALTIME, { token: WorkforceStatusService, optional: true }] },
  ],
  exports: [TimeClockService],
})
export class TimeClockModule {}
