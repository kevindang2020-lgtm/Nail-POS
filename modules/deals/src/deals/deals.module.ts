// deals.module.ts — Deals Marketplace domain (Phase 2). Kysely-backed when Postgres is present, else in-memory
// (dev/offline/tests). Reuses the canonical discount/geo/booking primitives in later phases.
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';
import { DealsOwnerController } from './deals.owner.controller';
import { DealsTechController } from './deals.tech.controller';
import { DealsCustomerController } from './deals.customer.controller';
import { DealsSuperAdminController } from './deals.super-admin.controller';
import { DealsService, DEAL_APPROVALS_TOKEN, type DealApprovalsPort } from './deals.service';
import { InMemoryDealsRepository, type DealsRepositoryPort } from './deals.repository';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { DealsCheckoutService } from '../engine/deals-checkout.service';
import { DealsLifecycleScheduler } from '../engine/deals-lifecycle.scheduler';

@Module({
  imports: [EventsCoreModule],   // the outbox writer deal redemptions are recorded through
  controllers: [DealsController, DealsTechController, DealsCustomerController, DealsSuperAdminController, DealsOwnerController],
  providers: [
    { provide: 'DealsRepositoryPort', useFactory: (db: AppDatabase, outbox: OutboxWriter): DealsRepositoryPort => (db ? new KyselyDealsRepository(db, outbox) : new InMemoryDealsRepository()), inject: [DATABASE, OutboxWriter] },
    // BUILD_PLAN Phase 9: deal approvals ride the salon approvals engine when the process has it (@Global token, optional)
    { provide: DealsService, useFactory: (repo: DealsRepositoryPort, approvals?: DealApprovalsPort | null) => new DealsService(repo).useApprovals(approvals ?? null), inject: ['DealsRepositoryPort', { token: DEAL_APPROVALS_TOKEN, optional: true }] },
    // BUILD_PLAN Phase 5: deals on POS tickets (null without a database — checkout then offers no deals, honestly)
    { provide: DealsCheckoutService, useFactory: (svc: DealsService, repo: DealsRepositoryPort) => (repo.ledger ? new DealsCheckoutService(svc, repo.ledger) : null), inject: [DealsService, 'DealsRepositoryPort'] },
    DealsLifecycleScheduler,
  ],
  exports: [DealsService, DealsCheckoutService],
})
export class DealsModule {}
