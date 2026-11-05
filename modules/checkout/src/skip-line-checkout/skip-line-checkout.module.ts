// skip-line-checkout.module.ts — Skip-the-Line Checkout. Reuses tickets/payments/receipts + the realtime bus.
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { Module } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { PaymentGatewayResolver } from '@aipowersalon/payments';
import { PAYMENT_SECRETS, type PaymentSecrets } from '@aipowersalon/security';
import { REALTIME, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { SkipLineCheckoutRepository } from './skip-line-checkout.repository';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { CustomerSkipLineController } from './customer-skip-line.controller';
import { TechCashConfirmationController } from './tech-cash-confirmation.controller';
import { PosSkipLineController } from './pos-skip-line.controller';
import { PosSkipLineSettingsController, SuperAdminSkipLineSettingsController } from './skip-line-settings.controller';

@Module({
  imports: [EventsCoreModule],   // the outbox writer skip-line payments record their facts through (§343)
  controllers: [CustomerSkipLineController, TechCashConfirmationController, PosSkipLineController, PosSkipLineSettingsController, SuperAdminSkipLineSettingsController],
  providers: [
    { provide: SkipLineCheckoutRepository, useFactory: (db: AppDatabase, outbox: OutboxWriter) => new SkipLineCheckoutRepository(db as any, outbox), inject: [DATABASE, OutboxWriter] },
    // the SALON's own gateway (per-tenant credentials, platform kill switch) — the same resolver checkout uses
    { provide: PaymentGatewayResolver, useFactory: (db: AppDatabase, secrets: PaymentSecrets) => new PaymentGatewayResolver(db, secrets), inject: [DATABASE, PAYMENT_SECRETS] },
    { provide: SkipLineCheckoutService, useFactory: (repo: SkipLineCheckoutRepository, rt: RealtimeEmitter, gw: PaymentGatewayResolver) => new SkipLineCheckoutService(repo, rt, gw), inject: [SkipLineCheckoutRepository, REALTIME, PaymentGatewayResolver] },
  ],
  exports: [SkipLineCheckoutService],
})
export class SkipLineCheckoutModule {}
