// wallet.module.ts — wires the wallet ledger. Binds the Postgres (Kysely) adapter when a DB handle is present, else the
// in-memory adapter (DB-less deploys report an empty wallet). Exports WalletLedgerService for the top-up/checkout paths.
import { Module } from '@nestjs/common';
import { CustomerWalletController } from './customer-wallet.controller';
import { WalletLedgerService } from './wallet.service';
import { InMemoryWalletLedgerRepository, type WalletLedgerPort } from './wallet.repository';
import { KyselyWalletLedgerRepository } from './wallet.kysely.repository';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [CustomerWalletController],
  providers: [
    { provide: 'WalletLedgerPort', useFactory: (db: AppDatabase): WalletLedgerPort => (db ? new KyselyWalletLedgerRepository(db) : new InMemoryWalletLedgerRepository()), inject: [DATABASE] },
    { provide: WalletLedgerService, useFactory: (repo: WalletLedgerPort) => new WalletLedgerService(repo), inject: ['WalletLedgerPort'] },
  ],
  exports: [WalletLedgerService],
})
export class WalletModule {}
