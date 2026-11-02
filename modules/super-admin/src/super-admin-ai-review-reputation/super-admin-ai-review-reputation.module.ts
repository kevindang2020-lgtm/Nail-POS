// super-admin-ai-review-reputation.module.ts — wires the Super Admin oversight surface. Read-only aggregates over the
// reputation tables; the audited support drill-down is reason-gated in the service. SuperAdminGuard is the auth boundary.
import { Module } from '@nestjs/common';
import { SuperAdminAiReviewReputationController } from './super-admin-ai-review-reputation.controller';
import { SuperAdminAiReviewReputationService } from './super-admin-ai-review-reputation.service';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';

@Module({
  controllers: [SuperAdminAiReviewReputationController],
  providers: [
    { provide: SuperAdminAiReviewReputationService, useFactory: (db: AppDatabase, audit: AuditService) => new SuperAdminAiReviewReputationService(db, audit), inject: [DATABASE_READ, AuditService] },
  ],
  exports: [SuperAdminAiReviewReputationService],
})
export class SuperAdminAiReviewReputationModule {}
