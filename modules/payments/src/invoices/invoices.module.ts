import { Module } from '@nestjs/common';
import { InvoicesController, INVOICES_LEDGER_REPOSITORY } from './invoices.controller';
import { InvoicesLedgerRepository } from './invoices-ledger.repository';
import { AuditService } from '@aipowersalon/audit';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { InvoicesService } from './invoices.service';
import { InMemoryInvoicesRepository, type InvoicesRepositoryPort } from './invoices.repository';
import { KyselyInvoicesRepository } from './invoices.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [InvoicesController, CustomerInvoicesController],
  providers: [
    { provide: 'InvoicesRepositoryPort', useFactory: (db: AppDatabase): InvoicesRepositoryPort => (db ? new KyselyInvoicesRepository(db) : new InMemoryInvoicesRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: InvoicesService, useFactory: (repo: InvoicesRepositoryPort) => new InvoicesService(repo), inject: ['InvoicesRepositoryPort'] },
    // Invoices mandate (Oct 29 2026): the one-screen page's ledger (payments, void, search, PDF); null without a database → 503
    { provide: INVOICES_LEDGER_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new InvoicesLedgerRepository(db, audit) : null), inject: [DATABASE, AuditService] },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
