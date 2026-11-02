/**
 * super-admin-customer-data.module.ts
 * ---------------------------------------------------------------------------
 * Wires the Customer Data Oversight controller + service + repository. Binds the Kysely (Postgres) repo when a DB
 * handle is present, else the in-memory repo so the module is runnable offline. Mount behind the auth pipeline
 * that populates req.ctx; the controller enforces the `super-admin` guard (the authorized cross-tenant path).
 */

import { LegalHoldService, InMemoryLegalHoldRepo, type LegalHoldRepo, KyselyLegalHoldRepo, CustomerIdentityModule } from '@aipowersalon/customers';
import { Module } from '@nestjs/common';
import { SuperAdminCustomerDataController } from './super-admin-customer-data.controller';
import { CustomerDataOversightService } from './super-admin-customer-data.service';
import { InMemoryCustomerDataOversightRepo, type CustomerDataOversightRepo } from './super-admin-customer-data.repository';
import { KyselyCustomerDataOversightRepo } from './super-admin-customer-data.kysely.repository';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportScheduler } from './customer-import.scheduler';
import { InMemoryImportRepo, type ImportRepo } from './customer-import.repository';
import { KyselyImportRepo } from './customer-import.kysely.repository';
import { CustomerDeletionService } from './customer-deletion.service';
import { InMemoryDeletionRepo, type DeletionRepo } from './customer-deletion.repository';
import { KyselyDeletionRepo } from './customer-deletion.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

export const CUSTOMER_DATA_OVERSIGHT_REPO = Symbol('CUSTOMER_DATA_OVERSIGHT_REPO');
export const LEGAL_HOLD_REPO = Symbol('LEGAL_HOLD_REPO');
export const CUSTOMER_IMPORT_REPO = Symbol('CUSTOMER_IMPORT_REPO');
export const CUSTOMER_DELETION_REPO = Symbol('CUSTOMER_DELETION_REPO');

@Module({
  imports: [CustomerIdentityModule],
  controllers: [SuperAdminCustomerDataController],
  providers: [
    {
      provide: CUSTOMER_DATA_OVERSIGHT_REPO,
      useFactory: (db: AppDatabase): CustomerDataOversightRepo => (db ? new KyselyCustomerDataOversightRepo(db) : new InMemoryCustomerDataOversightRepo()),
      inject: [DATABASE],
    },
    {
      provide: LEGAL_HOLD_REPO,
      useFactory: (db: AppDatabase): LegalHoldRepo => (db ? new KyselyLegalHoldRepo(db) : new InMemoryLegalHoldRepo()),
      inject: [DATABASE],
    },
    {
      provide: LegalHoldService,
      useFactory: (repo: LegalHoldRepo) => new LegalHoldService(repo),
      inject: [LEGAL_HOLD_REPO],
    },
    {
      provide: CUSTOMER_IMPORT_REPO,
      useFactory: (db: AppDatabase): ImportRepo => (db ? new KyselyImportRepo(db) : new InMemoryImportRepo()),
      inject: [DATABASE],
    },
    {
      provide: CustomerImportService,
      useFactory: (repo: ImportRepo) => new CustomerImportService(repo),
      inject: [CUSTOMER_IMPORT_REPO],
    },
    // Background worker for async customer imports (env-gated CUSTOMER_IMPORT_WORKER_ENABLED; off by default).
    CustomerImportScheduler,
    {
      provide: CUSTOMER_DELETION_REPO,
      useFactory: (db: AppDatabase): DeletionRepo => (db ? new KyselyDeletionRepo(db) : new InMemoryDeletionRepo()),
      inject: [DATABASE],
    },
    {
      provide: CustomerDeletionService,
      useFactory: (repo: DeletionRepo, holds: LegalHoldService) => new CustomerDeletionService(repo, holds),
      inject: [CUSTOMER_DELETION_REPO, LegalHoldService],
    },
    {
      provide: CustomerDataOversightService,
      useFactory: (repo: CustomerDataOversightRepo, holds: LegalHoldService, imports: CustomerImportService) => new CustomerDataOversightService(repo, holds, imports),
      inject: [CUSTOMER_DATA_OVERSIGHT_REPO, LegalHoldService, CustomerImportService],
    },
  ],
  exports: [CustomerDataOversightService, LegalHoldService, CustomerImportService, CustomerDeletionService],
})
export class SuperAdminCustomerDataModule {}
