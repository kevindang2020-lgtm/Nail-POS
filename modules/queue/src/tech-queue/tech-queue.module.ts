// tech-queue.module.ts — POS Tech Queue controller + service + repository. Kysely-backed adapter when a Postgres
// handle exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { PushModule, PushService } from '@aipowersalon/communications';
import { Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { lazyRecommender } from '../queue/queue-recommender.nest';
import { TechQueueController } from './tech-queue.controller';
import { TechQueueService } from './tech-queue.service';
import { InMemoryTechQueueRepository, type TechQueueRepositoryPort } from './tech-queue.repository';
import { KyselyTechQueueRepository } from './tech-queue.kysely.repository';
import { TechQueueAcceptanceScheduler } from './tech-queue-acceptance.scheduler';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';

@Module({
  imports: [EventsCoreModule, PushModule],
  controllers: [TechQueueController],
  providers: [
    { provide: 'TechQueueRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): TechQueueRepositoryPort => (db ? new KyselyTechQueueRepository(db, outbox) : new InMemoryTechQueueRepository()), inject: [DATABASE, OutboxWriter] },
    // BUILD_PLAN Phase 6: best match from QUEUE_RECOMMENDER, resolved lazily (the AI module depends on this service)
    { provide: TechQueueService, useFactory: (repo: TechQueueRepositoryPort, push: PushService, refs: ModuleRef) => new TechQueueService(repo, push, () => lazyRecommender(refs)), inject: ['TechQueueRepositoryPort', PushService, ModuleRef] },
    { provide: TechQueueAcceptanceScheduler, useFactory: (svc: TechQueueService, rt: RealtimeEmitter) => new TechQueueAcceptanceScheduler(svc, rt), inject: [TechQueueService, REALTIME] },
  ],
  exports: [TechQueueService],
})
export class TechQueueModule {}
