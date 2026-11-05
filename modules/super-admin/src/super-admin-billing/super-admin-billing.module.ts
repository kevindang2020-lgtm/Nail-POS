// super-admin-billing.module.ts — wires the Super-Admin Billing controller + service. Kysely adapter when a DB handle
// exists, else an empty in-memory adapter (zeros, never fabricated).
import { Module } from '@nestjs/common';
import { SuperAdminBillingController } from './billing.controller';
import { SuperAdminBillingService } from './billing.service';
import { InMemoryBillingRepository, type BillingDataPort } from './billing.repository';
import { KyselyBillingRepository } from './billing.kysely.repository';
import { BillingExportScheduler } from './billing-export.scheduler';
import { BillingCycleController } from './billing-cycle.controller';
import { SuperAdminBillingCycleService } from './billing-cycle.service';
import { BillingCycleScheduler } from './billing-cycle.scheduler';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminBillingController, BillingCycleController],
  providers: [
    { provide: 'BillingDataPort', useFactory: (db: AppDatabase): BillingDataPort => (db ? new KyselyBillingRepository(db) : new InMemoryBillingRepository()), inject: [DATABASE] },
    { provide: SuperAdminBillingService, useFactory: (repo: BillingDataPort) => new SuperAdminBillingService(repo), inject: ['BillingDataPort'] },
    BillingExportScheduler,
    SuperAdminBillingCycleService,
    BillingCycleScheduler,
  ],
  exports: [SuperAdminBillingService, SuperAdminBillingCycleService],
})
export class SuperAdminBillingModule {}
