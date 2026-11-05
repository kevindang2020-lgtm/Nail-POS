// payment-webhook.module.ts — inbound payment-gateway webhook surface.
import { Module } from '@nestjs/common';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { PaymentWebhookController } from '../payments/payment-webhook.controller';
import { PaymentWebhookService } from '../payments/payment-webhook.service';
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [PaymentWebhookController],
  providers: [
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: PaymentWebhookService, useFactory: (db: AppDatabase, resolver: PaymentGatewayResolver) => new PaymentWebhookService(db, resolver), inject: [DATABASE, PaymentGatewayResolver] },
  ],
})
export class PaymentWebhookModule {}
