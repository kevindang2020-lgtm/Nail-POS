// super-admin-ai-customer-profile.module.ts — wires the SA oversight surface. Reuses AiCustomerProfileService
// (imported from its module) for the per-tenant drill-down, the primary DATABASE for platform counts, and the
// @Global AuditService for support-mode audit.
import { AiCustomerProfileModule, AiCustomerProfileService } from '@aipowersalon/ai';
import { Module } from '@nestjs/common';
import { SuperAdminAiCustomerProfileController } from './super-admin-ai-customer-profile.controller';
import { SuperAdminAiCustomerProfileService } from './super-admin-ai-customer-profile.service';
import { AuditService } from '@aipowersalon/audit';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';

@Module({
  imports: [AiCustomerProfileModule],
  controllers: [SuperAdminAiCustomerProfileController],
  providers: [
    {
      provide: SuperAdminAiCustomerProfileService,
      useFactory: (db: AppDatabase, profile: AiCustomerProfileService, audit: AuditService) => new SuperAdminAiCustomerProfileService(db, profile, audit),
      inject: [DATABASE, AiCustomerProfileService, AuditService],
    },
  ],
})
export class SuperAdminAiCustomerProfileModule {}
