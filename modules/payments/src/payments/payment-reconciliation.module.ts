// payment-reconciliation.module.ts — per-tenant gateway reconciliation read.
import { Module } from '@nestjs/common';
import { PaymentReconciliationController } from '../payments/payment-reconciliation.controller';
import { PaymentReconciliationService } from '../payments/payment-reconciliation.service';
import { DATABASE, DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { SettlementsScreenController, SETTLEMENTS_SCREEN_REPOSITORY } from '../finance-screens/settlements-screen.controller';
import { SettlementsScreenRepository } from '../finance-screens/settlements-screen.repository';
import { TerminalsScreenController, TERMINALS_SCREEN_REPOSITORY } from '../finance-screens/terminals-screen.controller';
import { TerminalsScreenRepository } from '../finance-screens/terminals-screen.repository';
import { GiftCardsScreenController, GIFT_CARDS_SCREEN_REPOSITORY } from '../finance-screens/gift-cards-screen.controller';
import { GiftCardsScreenRepository } from '../finance-screens/gift-cards-screen.repository';
import { TipsScreenController, TIPS_SCREEN_REPOSITORY } from '../finance-screens/tips-screen.controller';
import { TipsScreenRepository } from '../finance-screens/tips-screen.repository';
import { SplitPaymentsScreenController, SPLIT_PAYMENTS_SCREEN_REPOSITORY } from '../finance-screens/split-payments-screen.controller';
import { SplitPaymentsScreenRepository } from '../finance-screens/split-payments-screen.repository';
import { CashHandoffsScreenController, CASH_HANDOFFS_SCREEN_REPOSITORY } from '../finance-screens/cash-handoffs-screen.controller';
import { CashHandoffsScreenRepository } from '../finance-screens/cash-handoffs-screen.repository';
import { RefundsVoidsScreenController, REFUNDS_VOIDS_SCREEN_REPOSITORY } from '../finance-screens/refunds-voids-screen.controller';
import { RefundsVoidsScreenRepository } from '../finance-screens/refunds-voids-screen.repository';
import { TransactionsScreenController, TRANSACTIONS_SCREEN_REPOSITORY } from '../finance-screens/transactions-screen.controller';
import { TransactionsScreenRepository } from '../finance-screens/transactions-screen.repository';
import { MoneyOverviewScreenController, MONEY_OVERVIEW_SCREEN_REPOSITORY } from '../finance-screens/money-overview-screen.controller';
import { MoneyOverviewScreenRepository } from '../finance-screens/money-overview-screen.repository';

@Module({
  controllers: [PaymentReconciliationController, SettlementsScreenController, TerminalsScreenController, GiftCardsScreenController, TipsScreenController, SplitPaymentsScreenController, CashHandoffsScreenController, RefundsVoidsScreenController, TransactionsScreenController, MoneyOverviewScreenController],   // + Deposits & Settlements, Payment Terminals, Gift Cards, Tips, Split Payments, End-of-Day Cash, Refunds & Voids, Transactions, Payments & Money mandates (Oct 29 2026)
  providers: [
    { provide: PaymentReconciliationService, useFactory: (db: AppDatabase) => new PaymentReconciliationService(db), inject: [DATABASE] },
    // read-only browsing (the export's audit row goes through AuditService's own connection) — the read replica when present
    { provide: GIFT_CARDS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new GiftCardsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
    { provide: TERMINALS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase) => (db ? new TerminalsScreenRepository(db) : null), inject: [DATABASE_READ] },
    { provide: TIPS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new TipsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
    { provide: SPLIT_PAYMENTS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new SplitPaymentsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
    { provide: CASH_HANDOFFS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new CashHandoffsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
    { provide: REFUNDS_VOIDS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new RefundsVoidsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
    { provide: TRANSACTIONS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new TransactionsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
    { provide: MONEY_OVERVIEW_SCREEN_REPOSITORY, useFactory: (db: AppDatabase) => (db ? new MoneyOverviewScreenRepository(db) : null), inject: [DATABASE_READ] },
    { provide: SETTLEMENTS_SCREEN_REPOSITORY, useFactory: (db: AppDatabase, audit: AuditService) => (db ? new SettlementsScreenRepository(db, audit) : null), inject: [DATABASE_READ, AuditService] },
  ],
})
export class PaymentReconciliationModule {}
