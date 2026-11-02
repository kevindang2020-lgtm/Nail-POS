// payment-gateway.module.ts — Oct 21 2026 (§105): the ONE provider router (tenant + branch → merchant → adapter) offered
// under a string token, so a domain that must take a card without importing the payments module (booking deposits — D11;
// payments → ai → booking would otherwise close a cycle) binds the port by name. Global: imported once by the API.
import { Global, Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { PaymentGatewayResolver } from './payment-gateway.resolver';

/** `{ resolve(tenantId, branchId?) → { configured, processorType, processor? } }` — a PaymentGatewayResolver, or null without a database */
export const PAYMENT_GATEWAY_TOKEN = 'PAYMENT_GATEWAY';

@Global()
@Module({
  providers: [{ provide: PAYMENT_GATEWAY_TOKEN, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => (db ? new PaymentGatewayResolver(db, secrets) : null), inject: [DATABASE, PAYMENT_SECRETS] }],
  exports: [PAYMENT_GATEWAY_TOKEN],
})
export class PaymentGatewayModule {}
