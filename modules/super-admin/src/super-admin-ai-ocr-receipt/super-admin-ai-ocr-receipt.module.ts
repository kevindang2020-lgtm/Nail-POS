// super-admin-ai-ocr-receipt.module.ts — wires the Super Admin oversight surface for the AI OCR Receipt pipeline.
// Read-only aggregates over the OCR tables; the audited support drill-down is reason-gated in the service.
// SuperAdminGuard is the auth boundary.
import { Module } from '@nestjs/common';
import { SuperAdminAiOcrReceiptController } from './super-admin-ai-ocr-receipt.controller';
import { SuperAdminAiOcrReceiptService } from './super-admin-ai-ocr-receipt.service';
import { DATABASE_READ, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';

@Module({
  controllers: [SuperAdminAiOcrReceiptController],
  providers: [
    { provide: SuperAdminAiOcrReceiptService, useFactory: (db: AppDatabase, audit: AuditService) => new SuperAdminAiOcrReceiptService(db, audit), inject: [DATABASE_READ, AuditService] },
  ],
  exports: [SuperAdminAiOcrReceiptService],
})
export class SuperAdminAiOcrReceiptModule {}
