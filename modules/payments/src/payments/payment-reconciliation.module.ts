// payment-reconciliation.module.ts — per-tenant gateway reconciliation read.
import { Module } from '@nestjs/common';
import { PaymentReconciliationController } from '../payments/payment-reconciliation.controller';
import { PaymentReconciliationService } from '../payments/payment-reconciliation.service';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [PaymentReconciliationController],
  providers: [
    { provide: PaymentReconciliationService, useFactory: (db: AppDatabase) => new PaymentReconciliationService(db), inject: [DATABASE] },
  ],
})
export class PaymentReconciliationModule {}
