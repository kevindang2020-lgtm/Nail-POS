// push.module.ts — wires the push token registry + dispatch. Uses the global DATABASE handle; falls back to the
// in-memory repo when no DB is configured (so the app boots in any mode). PushService is exported for notification
// sites to inject and call dispatchToUser().
import { Module } from '@nestjs/common';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { OutboxWriter } from '@aipowersalon/events';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { InMemoryPushRepository, type PushRepositoryPort } from './push.repository';
import { KyselyPushRepository } from './push.kysely.repository';

@Module({
  imports: [EventsCoreModule],   // Phase 2: communication.push_sent commits with the delivery-log row
  controllers: [PushController],
  providers: [
    { provide: 'PushRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): PushRepositoryPort => (db ? new KyselyPushRepository(db as any, outbox) : new InMemoryPushRepository()), inject: [DATABASE, OutboxWriter] },
    { provide: PushService, useFactory: (repo: PushRepositoryPort) => new PushService(repo), inject: ['PushRepositoryPort'] },
  ],
  exports: [PushService],
})
export class PushModule {}
