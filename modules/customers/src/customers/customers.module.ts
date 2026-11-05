// customers.module.ts — POS Customers controller + service + repository. Kysely-backed adapter when a Postgres handle
// exists (REPO_DRIVER=postgres), else the in-memory adapter (dev/offline/tests default).
import { SuperAdminPlansModule, EntitlementsService, AutomationEngineService } from '@aipowersalon/platform';
import { CustomerIdentityModule } from '../customer-identity/customer-identity.module';
import { CustomerIdentityService } from '../customer-identity/customer-identity.service';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { InMemoryCustomersRepository, type CustomersRepositoryPort } from './customers.repository';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { LoyaltyReconcileScheduler } from '../loyalty/loyalty-reconcile.scheduler';

@Module({
  imports: [EventsCoreModule, SuperAdminPlansModule, CustomerIdentityModule],
  controllers: [CustomersController],
  providers: [
    { provide: 'CustomersRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): CustomersRepositoryPort => (db ? new KyselyCustomersRepository(db, outbox) : new InMemoryCustomersRepository()), inject: [DATABASE, OutboxWriter] },
    // Phase 10: the daily loyalty.reconcile job (points_balance = sum of the ledger, repaired from it with an owner alert)
    { provide: LoyaltyReconcileScheduler, useFactory: (db: AppDatabase) => new LoyaltyReconcileScheduler(db ? (db as any) : null), inject: [DATABASE] },
    { provide: CustomersService, useFactory: (repo: CustomersRepositoryPort, audit: AuditService, ent: EntitlementsService, db: AppDatabase, identity: CustomerIdentityService, realtime: RealtimeEmitter) => new CustomersService(repo, audit, ent, db ? new AutomationEngineService(db as any) : null, identity, realtime), inject: ['CustomersRepositoryPort', AuditService, EntitlementsService, DATABASE, CustomerIdentityService, { token: REALTIME, optional: true }] },
  ],
  exports: [CustomersService],
})
export class CustomersModule {}
