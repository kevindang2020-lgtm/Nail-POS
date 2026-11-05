import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { InvoicesService } from './invoices.service';
import { InMemoryInvoicesRepository, type InvoicesRepositoryPort } from './invoices.repository';
import { KyselyInvoicesRepository } from './invoices.kysely.repository';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [InvoicesController, CustomerInvoicesController],
  providers: [
    { provide: 'InvoicesRepositoryPort', useFactory: (db: AppDatabase): InvoicesRepositoryPort => (db ? new KyselyInvoicesRepository(db) : new InMemoryInvoicesRepository()), inject: [DATABASE] },   // the PRIMARY: this repository WRITES (it was the read-replica handle)
    { provide: InvoicesService, useFactory: (repo: InvoicesRepositoryPort) => new InvoicesService(repo), inject: ['InvoicesRepositoryPort'] },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
