// super-admin-ai-checkout-upsell.module.ts — wires the SA oversight surface (primary DATABASE for counts, @Global audit).
import { Module } from '@nestjs/common';
import { SuperAdminAiCheckoutUpsellController } from './super-admin-ai-checkout-upsell.controller';
import { SuperAdminAiCheckoutUpsellService } from './super-admin-ai-checkout-upsell.service';
import { AuditService } from '@aipowersalon/audit';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  controllers: [SuperAdminAiCheckoutUpsellController],
  providers: [
    { provide: SuperAdminAiCheckoutUpsellService, useFactory: (db: AppDatabase, audit: AuditService) => new SuperAdminAiCheckoutUpsellService(db, audit), inject: [DATABASE, AuditService] },
  ],
})
export class SuperAdminAiCheckoutUpsellModule {}
