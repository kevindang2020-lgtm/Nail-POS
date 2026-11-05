// tech-appointments.module.ts — POS Tech Appointments controller + service + repository. Kysely-backed adapter when a
// Postgres handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { TechAppointmentsController } from './tech-appointments.controller';
import { TechAppointmentsService } from './tech-appointments.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { InMemoryTechApptRepository, type TechApptRepositoryPort } from './tech-appointments.repository';
import { KyselyTechApptRepository } from './tech-appointments.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [EventsCoreModule],
  controllers: [TechAppointmentsController],
  providers: [
    { provide: 'TechApptRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): TechApptRepositoryPort => (db ? new KyselyTechApptRepository(db, outbox) : new InMemoryTechApptRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: TechAppointmentsService, useFactory: (repo: TechApptRepositoryPort, realtime: RealtimeEmitter) => new TechAppointmentsService(repo, realtime), inject: ['TechApptRepositoryPort', { token: REALTIME, optional: true }] },
  ],
  exports: [TechAppointmentsService],
})
export class TechAppointmentsModule {}
