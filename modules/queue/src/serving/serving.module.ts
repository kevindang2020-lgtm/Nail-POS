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
import { KyselyManagerPinPort, STAFF_BRANCH_ACCESS, type StaffBranchAccessPort } from './manager-pin.kysely';
import { verifyPassword } from '@aipowersalon/auth';
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
    // B-19 (Oct 22 2026): the manager-at-till PIN port — a Postgres handle means the real check (users.pin_hash through
    // @aipowersalon/auth verifyPassword); without one (in-memory / tests) a PIN is never recognised, so the override needs the permission.
    { provide: ServingService, useFactory: (repo: ServingRepositoryPort, realtime: RealtimeEmitter, stock: InventoryService, eligibility?: TechnicianEligibilityService | null, db?: AppDatabase | null, branchAccess?: StaffBranchAccessPort | null) => new ServingService(repo, realtime, stock, eligibility ?? null, db ? new KyselyManagerPinPort(db, (pin, hash) => verifyPassword(pin, hash), branchAccess ?? null) : null), inject: ['ServingRepositoryPort', REALTIME, { token: InventoryService, optional: true }, { token: TechnicianEligibilityService, optional: true }, { token: DATABASE, optional: true }, { token: STAFF_BRANCH_ACCESS, optional: true }] },   // Oct 28 2026: the manager PIN works only at the manager's own location(s)
  ],
  exports: [ServingService],
})
export class ServingModule {}
