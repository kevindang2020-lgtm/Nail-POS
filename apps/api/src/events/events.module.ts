// events.module.ts — Constitution 8 wiring. One registry, one transport, one publisher, one writer.
// Factory-registered (the check:boot lesson: bare classes with defaulted/primitive ctor params fail Nest DI).
// The publisher only ticks when EVENT_PUBLISHER_ENABLED is set — exactly like the other ten workers.
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { REALTIME_PROJECTION_CONSUMER } from './consumers/realtime-projection.consumer';
import { ConsumerRegistry, ConsumerBudget, consumerBudgetFor, InProcessTransport, TRANSPORT, type EventTransport } from './event-transport';
import { ConsumerRunner } from './consumer-runner';
import { OutboxPublisher, PUBLISHER, publisherDatabase } from './outbox-publisher';
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

/** The pool the event pipeline runs on: the PRIMARY (DATABASE). Not DATABASE_WORKER — the worker role is least-privilege
 *  (jobs, telemetry, retention only; worker-role spec) and consumers write customer / money tables (loyalty, inventory,
 *  analytics, notifications). The consumer budget is derived from PG_POOL_MAX. */
export const EVENT_PIPELINE_DB = Symbol('EVENT_PIPELINE_DB');
/** The shared bound on open consumer transactions (consumerBudgetFor the pipeline pool's size). */
export const EVENT_CONSUMER_BUDGET = Symbol('EVENT_CONSUMER_BUDGET');
type Pipeline = ReturnType<typeof publisherDatabase>;

@Module({
  imports: [EventsCoreModule],   // provides OutboxWriter (Constitution 13 §75) — re-exported below for the API's own modules
  providers: [
    { provide: ConsumerRegistry, useFactory: () => new ConsumerRegistry() },
    // Oct 26 2026: the pipeline runs on the PRIMARY pool. A short-lived variant moved it onto DATABASE_WORKER, whose role
    // has no grants on the event / consumer tables (worker-role spec) — publishing would have failed on permissions in a
    // deployment with a separate worker role. The consumer budget (min(lanes × consumers, PG_POOL_MAX − 2)) still bounds it.
    { provide: EVENT_PIPELINE_DB, inject: [DATABASE], useFactory: (db: AppDatabase): Pipeline => publisherDatabase(db, null) },
    { provide: EVENT_CONSUMER_BUDGET, inject: [EVENT_PIPELINE_DB], useFactory: (p: Pipeline) => new ConsumerBudget(consumerBudgetFor(p.poolMax, PUBLISHER.lanes, TRANSPORT.consumerConcurrency)) },
    { provide: ConsumerRunner, inject: [EVENT_PIPELINE_DB], useFactory: (p: Pipeline) => (p.db ? new ConsumerRunner(p.db) : null) },
    { provide: EVENT_TRANSPORT, inject: [EVENT_PIPELINE_DB, ConsumerRegistry, ConsumerRunner, EVENT_CONSUMER_BUDGET],
      useFactory: (p: Pipeline, reg: ConsumerRegistry, runner: ConsumerRunner | null, budget: ConsumerBudget): EventTransport | null => (p.db && runner ? new InProcessTransport(p.db, reg, runner, TRANSPORT.consumerConcurrency, budget, { first: [REALTIME_PROJECTION_CONSUMER] }) : null) },   // §90: the realtime-first lane
    { provide: OutboxPublisher, inject: [EVENT_PIPELINE_DB, EVENT_TRANSPORT],
      useFactory: (p: Pipeline, t: EventTransport | null) => (p.db && t ? new OutboxPublisher(p.db, t, undefined, PUBLISHER.lanes) : null) },   // M4: lanes × concurrent consumers, within the budget (a real pool; PGlite tests construct the serial default)
    { provide: EventOpsService, inject: [DATABASE, ConsumerRegistry], useFactory: (db: AppDatabase, reg: ConsumerRegistry) => (db ? new EventOpsService(db, reg) : null) },
    { provide: DeadLetterRetryWorker, inject: [EVENT_PIPELINE_DB, ConsumerRegistry, ConsumerRunner],
      useFactory: (p: Pipeline, reg: ConsumerRegistry, runner: ConsumerRunner | null) => (p.db && runner ? new DeadLetterRetryWorker(p.db, reg, runner) : null) },
    { provide: EventReplayService, inject: [EVENT_PIPELINE_DB, ConsumerRegistry, ConsumerRunner],
      useFactory: (p: Pipeline, reg: ConsumerRegistry, runner: ConsumerRunner | null) => (p.db && runner ? new EventReplayService(p.db, reg, runner) : null) },
    { provide: EventRetentionWorker, inject: [EVENT_PIPELINE_DB], useFactory: (p: Pipeline) => (p.db ? new EventRetentionWorker(p.db) : null) },
    { provide: PublisherLifecycle, inject: [OutboxPublisher, DeadLetterRetryWorker, EventRetentionWorker], useFactory: (p: OutboxPublisher | null, r: DeadLetterRetryWorker | null, ret: EventRetentionWorker | null) => new PublisherLifecycle(p, r, ret) },
    EventPermissionGuard,
  ],
  controllers: [EventOpsController],
  exports: [EventsCoreModule, ConsumerRegistry, EVENT_TRANSPORT, OutboxPublisher, EventOpsService, DeadLetterRetryWorker, EventRetentionWorker, EventReplayService],
})
export class EventsModule {}
