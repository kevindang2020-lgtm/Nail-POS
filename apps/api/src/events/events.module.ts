// events.module.ts — Constitution 8 wiring. One registry, one transport, one publisher, one writer.
// Factory-registered (the check:boot lesson: bare classes with defaulted/primitive ctor params fail Nest DI).
// The publisher only ticks when EVENT_PUBLISHER_ENABLED is set — exactly like the other ten workers.
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { ConsumerRegistry, InProcessTransport, type EventTransport } from './event-transport';
import { ConsumerRunner } from './consumer-runner';
import { OutboxPublisher } from './outbox-publisher';
import { EventOpsService, DeadLetterRetryWorker } from './event-ops.service';
import { EventRetentionWorker } from './event-retention';
import { EventReplayService } from './event-replay.service';
import { EventOpsController, EventPermissionGuard } from './event-ops.controller';

export const EVENT_TRANSPORT = Symbol('EVENT_TRANSPORT');

class PublisherLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly publisher: OutboxPublisher | null, private readonly retry: DeadLetterRetryWorker | null, private readonly retention: EventRetentionWorker | null) {}
  onModuleInit() { this.publisher?.start(); this.retry?.start(); this.retention?.start(); }
  onModuleDestroy() { this.publisher?.stop(); this.retry?.stop(); this.retention?.stop(); }
}

@Module({
  imports: [EventsCoreModule],   // provides OutboxWriter (Constitution 13 §75) — re-exported below for the API's own modules
  providers: [
    { provide: ConsumerRegistry, useFactory: () => new ConsumerRegistry() },
    { provide: ConsumerRunner, inject: [DATABASE], useFactory: (db: AppDatabase) => (db ? new ConsumerRunner(db) : null) },
    { provide: EVENT_TRANSPORT, inject: [DATABASE, ConsumerRegistry, ConsumerRunner],
      useFactory: (db: AppDatabase, reg: ConsumerRegistry, runner: ConsumerRunner | null): EventTransport | null => (db && runner ? new InProcessTransport(db, reg, runner) : null) },
    { provide: OutboxPublisher, inject: [DATABASE, EVENT_TRANSPORT],
      useFactory: (db: AppDatabase, t: EventTransport | null) => (db && t ? new OutboxPublisher(db, t) : null) },
    { provide: EventOpsService, inject: [DATABASE, ConsumerRegistry], useFactory: (db: AppDatabase, reg: ConsumerRegistry) => (db ? new EventOpsService(db, reg) : null) },
    { provide: DeadLetterRetryWorker, inject: [DATABASE, ConsumerRegistry, ConsumerRunner],
      useFactory: (db: AppDatabase, reg: ConsumerRegistry, runner: ConsumerRunner | null) => (db && runner ? new DeadLetterRetryWorker(db, reg, runner) : null) },
    { provide: EventReplayService, inject: [DATABASE, ConsumerRegistry, ConsumerRunner],
      useFactory: (db: AppDatabase, reg: ConsumerRegistry, runner: ConsumerRunner | null) => (db && runner ? new EventReplayService(db, reg, runner) : null) },
    { provide: EventRetentionWorker, inject: [DATABASE], useFactory: (db: AppDatabase) => (db ? new EventRetentionWorker(db) : null) },
    { provide: PublisherLifecycle, inject: [OutboxPublisher, DeadLetterRetryWorker, EventRetentionWorker], useFactory: (p: OutboxPublisher | null, r: DeadLetterRetryWorker | null, ret: EventRetentionWorker | null) => new PublisherLifecycle(p, r, ret) },
    EventPermissionGuard,
  ],
  controllers: [EventOpsController],
  exports: [EventsCoreModule, ConsumerRegistry, EVENT_TRANSPORT, OutboxPublisher, EventOpsService, DeadLetterRetryWorker, EventRetentionWorker, EventReplayService],
})
export class EventsModule {}
