// customer-identity.module.ts — wires the global identity layer (Kevin's sync spec, Jul 26 2026).
// Repository → real Kysely when a DATABASE is bound, InMemory otherwise (the platform's standard factory shape).
import { AuditModule, AuditService } from '@aipowersalon/audit';
import { Module } from '@nestjs/common';
import { DATABASE } from '@aipowersalon/database';
import type { AppDatabase } from '@aipowersalon/database';
import type { CustomerIdentityRepositoryPort } from './customer-identity.repository';
import { InMemoryCustomerIdentityRepository } from './customer-identity.repository';
import { KyselyCustomerIdentityRepository } from './customer-identity.repository';
import { CustomerIdentityService } from './customer-identity.service';
import { CustomerReconciliationService, CustomerSyncScheduler } from './customer-reconciliation.service';
import { LegalHoldService } from '../legal-hold/legal-hold.service';

@Module({
  imports: [AuditModule],
  providers: [
    { provide: 'CustomerIdentityRepositoryPort', useFactory: (db: AppDatabase): CustomerIdentityRepositoryPort => (db ? new KyselyCustomerIdentityRepository(db) : new InMemoryCustomerIdentityRepository()), inject: [DATABASE] },
    { provide: CustomerIdentityService, useFactory: (repo: CustomerIdentityRepositoryPort, audit: AuditService) => new CustomerIdentityService(repo, audit), inject: ['CustomerIdentityRepositoryPort', AuditService] },
    { provide: CustomerReconciliationService, useFactory: (repo: CustomerIdentityRepositoryPort, identity: CustomerIdentityService, holds: LegalHoldService) => new CustomerReconciliationService(repo, identity, holds), inject: ['CustomerIdentityRepositoryPort', CustomerIdentityService, { token: LegalHoldService, optional: true }] },
    { provide: CustomerSyncScheduler, useFactory: (svc: CustomerReconciliationService, repo: CustomerIdentityRepositoryPort) => new CustomerSyncScheduler(svc, repo), inject: [CustomerReconciliationService, 'CustomerIdentityRepositoryPort'] },
  ],
  exports: [CustomerIdentityService, CustomerReconciliationService],
})
export class CustomerIdentityModule {}
