// serving.module.ts — POS Serving controller + service + repository. Kysely-backed adapter when a Postgres handle
// exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { InventoryService, InventoryModule } from '@aipowersalon/inventory';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { ServingController } from './serving.controller';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, type ServingRepositoryPort } from './serving.repository';
import { KyselyServingRepository } from './serving.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { TechnicianEligibilityModule, TechnicianEligibilityService, WORKFORCE_STATE_PORT, type WorkforceStatePort } from '@aipowersalon/workforce';

@Module({
  // InventoryModule (not @Global): without it the optional InventoryService below never resolved here and no retail sale
  // ever moved stock (wave 4 PILOT, Oct 13 2026)
  imports: [EventsCoreModule, TechnicianEligibilityModule, InventoryModule],
  controllers: [ServingController],
  providers: [
    // merge Oct 12 2026: the Postgres adapter carries the workforce state port (@Global WorkforceStatusModule) so THE Service
    // Done transition projects serviceCompleted after commit; optional so a test module without it still boots.
    { provide: 'ServingRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter, workforce?: WorkforceStatePort | null): ServingRepositoryPort => (db ? new KyselyServingRepository(db, outbox, { workforce: workforce ?? null }) : new InMemoryServingRepository()), inject: [DATABASE, OutboxWriter, { token: WORKFORCE_STATE_PORT, optional: true }] },
    // InventoryService is optional: a retail sale still writes its line when inventory is absent — it just doesn't move stock.
    // TechnicianEligibilityService (@Global, null without a DB) is THE ONE eligibility authority for start / assign / helper.
    { provide: ServingService, useFactory: (repo: ServingRepositoryPort, realtime: RealtimeEmitter, stock: InventoryService, eligibility?: TechnicianEligibilityService | null) => new ServingService(repo, realtime, stock, eligibility ?? null), inject: ['ServingRepositoryPort', REALTIME, { token: InventoryService, optional: true }, { token: TechnicianEligibilityService, optional: true }] },
  ],
  exports: [ServingService],
})
export class ServingModule {}
