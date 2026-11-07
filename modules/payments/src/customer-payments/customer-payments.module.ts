// customer-payments.module.ts — wires saved payment methods + wallet top-up. Reuses the per-tenant PaymentGatewayResolver
// (real charge path) and the WalletLedgerService (from WalletModule) for the idempotent credit.
import { WalletLedgerService, WalletModule } from '@aipowersalon/customers';
import { Module } from '@nestjs/common';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { CustomerPaymentsController } from './customer-payments.controller';
import { PosCustomerPaymentsController } from './pos-customer-payments.controller';
import { CustomerPaymentMethodsService, WalletTopupService, KyselyWalletTopupIntentStore, InMemoryWalletTopupIntentStore } from './customer-payments.service';
import { InMemoryCustomerPaymentMethodsRepository, KyselyCustomerPaymentMethodsRepository, type CustomerPaymentMethodsPort } from './customer-payments.repository';
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [WalletModule],
  controllers: [CustomerPaymentsController, PosCustomerPaymentsController],
  providers: [
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: 'CustomerPaymentMethodsPort', useFactory: (db: AppDatabase): CustomerPaymentMethodsPort => (db ? new KyselyCustomerPaymentMethodsRepository(db) : new InMemoryCustomerPaymentMethodsRepository()), inject: [DATABASE] },
    { provide: CustomerPaymentMethodsService, useFactory: (repo: CustomerPaymentMethodsPort, resolver: PaymentGatewayResolver) => new CustomerPaymentMethodsService(repo, resolver), inject: ['CustomerPaymentMethodsPort', PaymentGatewayResolver] },
    { provide: WalletTopupService, useFactory: (resolver: PaymentGatewayResolver, repo: CustomerPaymentMethodsPort, ledger: WalletLedgerService, db: AppDatabase) => new WalletTopupService(resolver, repo, ledger, db ? new KyselyWalletTopupIntentStore(db) : new InMemoryWalletTopupIntentStore()), inject: [PaymentGatewayResolver, 'CustomerPaymentMethodsPort', WalletLedgerService, DATABASE] },
  ],
  exports: [WalletTopupService],   // the stranded sweep (modules/checkout) settles open top-ups in the same tick (B-79)
})
export class CustomerPaymentsModule {}
