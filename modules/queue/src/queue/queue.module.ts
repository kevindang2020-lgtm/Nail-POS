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
import { TechnicianEligibilityService } from '@aipowersalon/workforce';

@Module({
  imports: [EventsCoreModule, PushModule, CustomerIdentityModule],
  controllers: [QueueController, CustomerQueueController],
  providers: [
    { provide: 'QueueRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): QueueRepositoryPort => (db ? new KyselyQueueRepository(db, outbox) : new InMemoryQueueRepository()), inject: [DATABASE, OutboxWriter] },
    // BUILD_PLAN Phase 6: QUEUE_RECOMMENDER (bound by the AI module, which itself depends on QueueService) is resolved
    // LAZILY through ModuleRef at call time — a constructor injection would be a dependency cycle. Not bound → null →
    // the boards show no suggestion (never a second scorer).
    // deep-scan (Oct 22 2026): the exact-service eligibility authority (global workforce module; null without a database)
    { provide: QueueService, useFactory: (repo: QueueRepositoryPort, realtime: RealtimeEmitter, push: PushService, identity: CustomerIdentityService, refs: ModuleRef, eligibility: TechnicianEligibilityService | null) => {
        const svc = new QueueService(repo, realtime, push, identity, () => lazyRecommender(refs));
        // §24 (Oct 27 2026): with a database the exact-service authority is the ONLY skill rule — booting without it would
        // leave the queue on the in-memory dev derivation, so it is refused (fail closed) instead of running lenient
        if (repo instanceof KyselyQueueRepository && !eligibility) throw new Error('QueueModule: the technician eligibility authority (TechnicianEligibilityModule) must be bound when a database is configured.');
        svc.eligibility = eligibility ?? null;
        return svc;
      },
      inject: ['QueueRepositoryPort', REALTIME, PushService, CustomerIdentityService, ModuleRef, { token: TechnicianEligibilityService, optional: true }] },
  ],
  exports: [QueueService],
})
export class QueueModule {}

