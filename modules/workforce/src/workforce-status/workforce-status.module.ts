// workforce-status.module.ts — @Global so every module that reads technician availability (queue, tech-queue,
// serving, booking, roster, live schedule, time clock) injects WorkforceStatusService (or the WORKFORCE_STATE_PORT
// seam) without importing this module. Kysely store over technician_workforce_state (579) when Postgres is present,
// else in-memory (dev/offline/tests). Merged from the Oct 2026 Technician Profile package.
import { Global, Module } from '@nestjs/common';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { WorkforceStatusService } from './workforce-status.service';
import { InMemoryWorkforceStateStore, type WorkforceStateStore } from './workforce-status.repository';
import { KyselyWorkforceStateStore } from './workforce-status.kysely.repository';
import { WorkforceStatusController } from './workforce-status.controller';
import { WorkforceStatePortAdapter } from './workforce-state-port.adapter';
import { WORKFORCE_STATE_PORT, type WorkforceStatePort } from './workforce-ports';

@Global()
@Module({
  imports: [EventsCoreModule],   // the outbox writer each CAS records technician.status_changed through (§343)
  controllers: [WorkforceStatusController],
  providers: [
    { provide: 'WorkforceStateStore', useFactory: (db: AppDatabase, outbox: OutboxWriter): WorkforceStateStore => (db ? new KyselyWorkforceStateStore(db, outbox) : new InMemoryWorkforceStateStore()), inject: [DATABASE, OutboxWriter] },   // the PRIMARY: every write is a compare-and-set
    // Fair Turn Engine: the clock / break CAS also moves the technician turn queue; its turn events ride the same outbox
    { provide: WorkforceStatusService, useFactory: (store: WorkforceStateStore, rt: RealtimeEmitter | undefined, outbox: OutboxWriter) => new WorkforceStatusService(store, rt ?? null, outbox), inject: ['WorkforceStateStore', { token: REALTIME, optional: true }, OutboxWriter] },
    { provide: WORKFORCE_STATE_PORT, useFactory: (svc: WorkforceStatusService): WorkforceStatePort => new WorkforceStatePortAdapter(svc), inject: [WorkforceStatusService] },
  ],
  exports: [WorkforceStatusService, 'WorkforceStateStore', WORKFORCE_STATE_PORT],
})
export class WorkforceStatusModule {}
