// ai-queue-assignment-ops.module.ts — BUILD_PLAN Phase 6: the AI queue OPS layer (agent C): the ONE settings source,
// alerts + the detection core, the per-branch background jobs, notifications, analytics / exports / usage, the owner's
// branch comparison and the Super Admin oversight. It imports agent B's QueueAssignmentCoreModule (the shared providers:
// the settings port QUEUE_ASSIGNMENT_SETTINGS, QueueAssignmentService for the background auto-run, the entitlement port,
// QueueModule / TechQueueModule) — the same instances the tenant routes use; neither route module imports the other.
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import type { AssignmentEmitterPort } from './ai-queue-assignment.ports';
import { QueueService, TechQueueService } from '@aipowersalon/queue';
import { PushModule, PushService } from '@aipowersalon/communications';
import type { QueueAssignmentSettingsPort } from './ai-queue-assignment-settings';
import { QUEUE_ASSIGNMENT_SETTINGS } from './ai-queue-assignment.tokens';
import { QueueAssignmentCoreModule } from './ai-queue-assignment-core.module';
import { KyselyQueueAlertRepository, InMemoryQueueAlertRepository, type QueueAlertRepositoryPort } from './ai-queue-assignment-alerts.repository';
import { QueueAlertService } from './ai-queue-assignment-alerts.service';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import { QueueServiceOpsAdapter, type QueueOpsQueuePort } from './ai-queue-assignment-ops.ports';
import { KyselyQueueOpsRead, InMemoryQueueOpsRead, type QueueOpsReadPort } from './ai-queue-assignment-ops.repository';
import { RealtimeOpsEmitter, KyselyQueueAlertNotifier, type OpsEmitterPort, type QueueAlertNotifierPort } from './ai-queue-assignment-ops.notifications';
import { QueueOpsService } from './ai-queue-assignment-ops.service';
import { QueueOpsScheduler } from './ai-queue-assignment-ops.jobs';
import { QueueAssignmentOpsController } from './ai-queue-assignment-ops.controller';
import { OwnerQueueAssignmentController } from './ai-queue-assignment-owner.controller';
import { QueueSuperAdminController, QueueSuperAdminService } from './ai-queue-assignment-superadmin.controller';
import { KyselyQueueSuperAdminRead, InMemoryQueueSuperAdminRead, type QueueSuperAdminReadPort } from './ai-queue-assignment-superadmin.repository';


@Module({
  imports: [EventsCoreModule, QueueAssignmentCoreModule, PushModule],
  controllers: [QueueAssignmentOpsController, OwnerQueueAssignmentController, QueueSuperAdminController],
  providers: [
    { provide: 'QueueOpsAlertRepository', useFactory: (db: AppDatabase, outbox: OutboxWriter): QueueAlertRepositoryPort => (db ? new KyselyQueueAlertRepository(db, outbox) : new InMemoryQueueAlertRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: 'QueueOpsQueuePort', useFactory: (q: QueueService, tq: TechQueueService): QueueOpsQueuePort => new QueueServiceOpsAdapter(q, tq), inject: [QueueService, TechQueueService] },
    { provide: 'QueueOpsReadPort', useFactory: (db: AppDatabase): QueueOpsReadPort => (db ? new KyselyQueueOpsRead(db) : new InMemoryQueueOpsRead()), inject: [DATABASE] },
    { provide: 'QueueOpsEmitter', useFactory: (inner: AssignmentEmitterPort): OpsEmitterPort => new RealtimeOpsEmitter(inner), inject: ['QueueAssignmentEmitter'] },
    { provide: 'QueueOpsNotifier', useFactory: (db: AppDatabase, push: PushService): QueueAlertNotifierPort | null => (db ? new KyselyQueueAlertNotifier(db, push) : null), inject: [DATABASE, PushService] },
    {
      provide: QueueAlertService,
      useFactory: (alerts: QueueAlertRepositoryPort, settings: QueueAssignmentSettingsPort, queue: QueueOpsQueuePort, ent: QueueAssignmentEntitlementPort, emitter: OpsEmitterPort, notifier: QueueAlertNotifierPort | null) =>
        new QueueAlertService(alerts, settings, queue, ent, emitter, notifier),
      inject: ['QueueOpsAlertRepository', QUEUE_ASSIGNMENT_SETTINGS, 'QueueOpsQueuePort', 'QueueAssignmentEntitlementPort', 'QueueOpsEmitter', 'QueueOpsNotifier'],
    },
    {
      provide: QueueOpsService,
      useFactory: (settings: QueueAssignmentSettingsPort, alerts: QueueAlertRepositoryPort, queue: QueueOpsQueuePort, read: QueueOpsReadPort, ent: QueueAssignmentEntitlementPort, emitter: OpsEmitterPort) =>
        new QueueOpsService(settings, alerts, queue, read, ent, emitter),
      inject: [QUEUE_ASSIGNMENT_SETTINGS, 'QueueOpsAlertRepository', 'QueueOpsQueuePort', 'QueueOpsReadPort', 'QueueAssignmentEntitlementPort', 'QueueOpsEmitter'],
    },
    { provide: 'QueueOpsSuperAdminRead', useFactory: (db: AppDatabase): QueueSuperAdminReadPort => (db ? new KyselyQueueSuperAdminRead(db) : new InMemoryQueueSuperAdminRead()), inject: [DATABASE] },
    {
      provide: QueueSuperAdminService,
      useFactory: (read: QueueSuperAdminReadPort, settings: QueueAssignmentSettingsPort, emitter: OpsEmitterPort, db: AppDatabase) => new QueueSuperAdminService(read, settings, emitter, db ?? null),
      inject: ['QueueOpsSuperAdminRead', QUEUE_ASSIGNMENT_SETTINGS, 'QueueOpsEmitter', DATABASE],
    },
    QueueOpsScheduler,
  ],
  exports: [QueueAlertService, QueueOpsService],
})
export class QueueAssignmentOpsModule {}
