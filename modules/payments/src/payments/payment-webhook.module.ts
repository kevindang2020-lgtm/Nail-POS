// payment-webhook.module.ts — inbound payment-gateway webhook surface.
import { Logger, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WalletTopupService } from '../customer-payments/customer-payments.service';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { PaymentWebhookController } from '../payments/payment-webhook.controller';
import { PaymentWebhookService } from '../payments/payment-webhook.service';
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [PaymentWebhookController],
  providers: [
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    // §15 (Oct 27 2026): a top-up order's charge event settles the wallet intent through WalletTopupService (exported by
    // CustomerPaymentsModule), found at call time — absent in a process without it, the event is still recorded.
    { provide: PaymentWebhookService, useFactory: (db: AppDatabase, resolver: PaymentGatewayResolver, modules: ModuleRef) => new PaymentWebhookService(db, resolver, () => {
      try { return modules.get(WalletTopupService, { strict: false }) ?? null; }
      catch (e) { new Logger('PaymentWebhook').debug(`WalletTopupService is not loaded in this process — top-up webhooks are recorded, not settled (${String((e as Error)?.message ?? e).slice(0, 120)})`); return null; }
    }), inject: [DATABASE, PaymentGatewayResolver, ModuleRef] },
  ],
})
export class PaymentWebhookModule {}
