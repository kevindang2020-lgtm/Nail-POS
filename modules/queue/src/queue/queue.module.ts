// queue.module.ts — POS Queue controller + service + repository. Kysely-backed adapter when a Postgres handle exists
// (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { CustomerIdentityModule, CustomerIdentityService } from '@aipowersalon/customers';
import { PushModule, PushService } from '@aipowersalon/communications';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { QueueController, CustomerQueueController } from './queue.controller';
import { lazyRecommender } from './queue-recommender.nest';
import { QueueService } from './queue.service';
import { InMemoryQueueRepository, type QueueRepositoryPort } from './queue.repository';
import { KyselyQueueRepository } from './queue.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';

@Module({
  imports: [EventsCoreModule, PushModule, CustomerIdentityModule],
  controllers: [QueueController, CustomerQueueController],
  providers: [
    { provide: 'QueueRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): QueueRepositoryPort => (db ? new KyselyQueueRepository(db, outbox) : new InMemoryQueueRepository()), inject: [DATABASE, OutboxWriter] },
    // BUILD_PLAN Phase 6: QUEUE_RECOMMENDER (bound by the AI module, which itself depends on QueueService) is resolved
    // LAZILY through ModuleRef at call time — a constructor injection would be a dependency cycle. Not bound → null →
    // the boards show no suggestion (never a second scorer).
    { provide: QueueService, useFactory: (repo: QueueRepositoryPort, realtime: RealtimeEmitter, push: PushService, identity: CustomerIdentityService, refs: ModuleRef) =>
        new QueueService(repo, realtime, push, identity, () => lazyRecommender(refs)),
      inject: ['QueueRepositoryPort', REALTIME, PushService, CustomerIdentityService, ModuleRef] },
  ],
  exports: [QueueService],
})
export class QueueModule {}

