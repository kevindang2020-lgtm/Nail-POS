// service-done.module.ts — POS Service Done controller + service + repository. Kysely-backed adapter when a Postgres
// handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { ServiceDoneController } from './service-done.controller';
import { ServiceDoneService } from './service-done.service';
import { InMemoryServiceDoneRepository, type ServiceDoneRepositoryPort } from './service-done.repository';
import { KyselyServiceDoneRepository } from './service-done.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { AuditService } from '@aipowersalon/audit';
import { WorkforceStatusService } from '@aipowersalon/workforce';

@Module({
  imports: [EventsCoreModule],
  controllers: [ServiceDoneController],
  providers: [
    // merge Oct 12 2026: ready/finishing technicians read the ONE workforce state (@Global WorkforceStatusModule) when bound
    { provide: 'ServiceDoneRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter, wf?: WorkforceStatusService | null): ServiceDoneRepositoryPort => (db ? new KyselyServiceDoneRepository(db, outbox, wf ?? null) : new InMemoryServiceDoneRepository()), inject: [DATABASE, OutboxWriter, { token: WorkforceStatusService, optional: true }] },
    { provide: ServiceDoneService, useFactory: (repo: ServiceDoneRepositoryPort, realtime: RealtimeEmitter, audit: AuditService) => new ServiceDoneService(repo, realtime, audit), inject: ['ServiceDoneRepositoryPort', REALTIME, AuditService] },
  ],
  exports: [ServiceDoneService],
})
export class ServiceDoneModule {}
