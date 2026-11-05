// ai-queue-assignment-core.module.ts — BUILD_PLAN Phase 6: the AI queue-assignment providers WITHOUT routes, so the
// tenant routes (QueueAssignmentModule) and the ops module (alerts / jobs / analytics — Agent C) both import ONE set of
// instances and neither imports the other (no module cycle). The alerts service + routes live in the ops module.
//
// Reuses QueueModule (QueueService) for inputs (load / availability / shift signals included) + the queue's own assign,
// TechAppointmentsModule for bookings, the global realtime bus (REALTIME) and the global OutboxWriter. Repo, settings and
// entitlement resolve to Kysely when a DB is present, else in-memory (dev/test).
import { Module } from '@nestjs/common';
import { TechQueueModule, QueueModule, QueueService } from '@aipowersalon/queue';
import { TechAppointmentsModule, TechAppointmentsService } from '@aipowersalon/appointments';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { QueueAssignmentService } from './ai-queue-assignment.service';
import { InMemoryQueueAssignmentRepository, type QueueAssignmentRepositoryPort } from './ai-queue-assignment.repository';
import { KyselyQueueAssignmentRepository } from './ai-queue-assignment.kysely.repository';
import { InMemoryQueueAssignmentEntitlement, KyselyQueueAssignmentEntitlement, type QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import { QueueServiceDataAdapter, RealtimeAssignmentEmitter, TechAppointmentsAdapter, QueueScanAdapter, QueueAssignExecutionAdapter, KyselyTurnReadAdapter } from './ai-queue-assignment.adapters';
import type { QueueDataPort, AssignmentEmitterPort, AppointmentDataPort, QueueScanPort, AssignExecutionPort, TurnReadPort } from './ai-queue-assignment.ports';
import { InMemoryQueueAssignmentSettings, KyselyQueueAssignmentSettings, type QueueAssignmentSettingsPort } from './ai-queue-assignment-settings';
import { QUEUE_ASSIGNMENT_SETTINGS } from './ai-queue-assignment.tokens';
import { QueueRecommenderModule } from './ai-queue-assignment-recommender';

const PORTS = ['QueueAssignmentRepositoryPort', 'QueueAssignmentEntitlementPort', 'QueueAssignmentDataPort', 'QueueAssignmentScanPort',
  'QueueAssignmentAssignExec', 'QueueAssignmentAppointmentPort', 'QueueAssignmentEmitter'];

@Module({
  // EventsCoreModule provides OutboxWriter. It was injected { optional: true } without this import, so in the running API
  // the decision / auto-assign / settings events were silently never written (found by the Phase 6 live proof).
  imports: [EventsCoreModule, QueueModule, TechQueueModule, TechAppointmentsModule, QueueRecommenderModule],
  providers: [
    { provide: 'QueueAssignmentRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): QueueAssignmentRepositoryPort => db ? new KyselyQueueAssignmentRepository(db as any, outbox) : new InMemoryQueueAssignmentRepository(), inject: [DATABASE, OutboxWriter] },
    { provide: 'QueueAssignmentEntitlementPort', useFactory: (db: AppDatabase): QueueAssignmentEntitlementPort => db ? new KyselyQueueAssignmentEntitlement(db as any) : new InMemoryQueueAssignmentEntitlement(), inject: [DATABASE] },
    { provide: QUEUE_ASSIGNMENT_SETTINGS, useFactory: (db: AppDatabase, outbox: OutboxWriter): QueueAssignmentSettingsPort => db ? new KyselyQueueAssignmentSettings(db as any, outbox) : new InMemoryQueueAssignmentSettings(), inject: [DATABASE, OutboxWriter] },
    { provide: 'QueueAssignmentDataPort', useFactory: (q: QueueService): QueueDataPort => new QueueServiceDataAdapter(q), inject: [QueueService] },
    { provide: 'QueueAssignmentScanPort', useFactory: (q: QueueService): QueueScanPort => new QueueScanAdapter(q), inject: [QueueService] },
    { provide: 'QueueAssignmentAssignExec', useFactory: (q: QueueService): AssignExecutionPort => new QueueAssignExecutionAdapter(q), inject: [QueueService] },
    { provide: 'QueueAssignmentAppointmentPort', useFactory: (ta: TechAppointmentsService): AppointmentDataPort => new TechAppointmentsAdapter(ta), inject: [TechAppointmentsService] },
    { provide: 'QueueAssignmentEmitter', useFactory: (rt: RealtimeEmitter): AssignmentEmitterPort => new RealtimeAssignmentEmitter(rt), inject: [REALTIME] },
    // Fair Turn Engine (wave 2): today's technician turn queue for the fairness modes (no DB → the scoring engine)
    { provide: 'QueueAssignmentTurnPort', useFactory: (db: AppDatabase): TurnReadPort | null => (db ? new KyselyTurnReadAdapter(db) : null), inject: [DATABASE] },
    {
      provide: QueueAssignmentService,
      useFactory: (repo: QueueAssignmentRepositoryPort, data: QueueDataPort, ent: QueueAssignmentEntitlementPort, emitter: AssignmentEmitterPort,
        appointments: AppointmentDataPort, scan: QueueScanPort, settings: QueueAssignmentSettingsPort, assign: AssignExecutionPort, turn: TurnReadPort | null) =>
        new QueueAssignmentService(repo, data, ent, emitter, { appointments, scan, settings, assign, ...(turn ? { turn } : {}) }),
      inject: ['QueueAssignmentRepositoryPort', 'QueueAssignmentDataPort', 'QueueAssignmentEntitlementPort', 'QueueAssignmentEmitter',
        'QueueAssignmentAppointmentPort', 'QueueAssignmentScanPort', QUEUE_ASSIGNMENT_SETTINGS, 'QueueAssignmentAssignExec', 'QueueAssignmentTurnPort'],
    },
  ],
  exports: [QueueAssignmentService, QUEUE_ASSIGNMENT_SETTINGS, ...PORTS, QueueModule, TechQueueModule],
})
export class QueueAssignmentCoreModule {}
