// async-export.module.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the ONE async operation contract — the
// @AsyncExport interceptor (registered globally in AppModule, before the export-snapshot interceptor), the `api.export`
// worker, the 24 h expiry sweep, and the per-realm operations routes.
import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditService, auditSinkFor } from '@aipowersalon/audit';
import { makePrivateStore } from '@aipowersalon/media';
import { AsyncExportService, ASYNC_EXPORT_AUDIT, PRIVATE_OPERATION_STORE } from './async-export.service';
import { AsyncExportInterceptor } from './async-export.interceptor';
import {
  PosOperationsController, OwnerOperationsController, TechOperationsController, SuperAdminOperationsController, CustomerOperationsController,
} from './operations.controller';

@Module({
  imports: [DiscoveryModule],
  controllers: [PosOperationsController, OwnerOperationsController, TechOperationsController, SuperAdminOperationsController, CustomerOperationsController],
  providers: [
    { provide: PRIVATE_OPERATION_STORE, useFactory: () => makePrivateStore() },
    { provide: ASYNC_EXPORT_AUDIT, useFactory: (a?: AuditService) => (a ? auditSinkFor(a) : null), inject: [{ token: AuditService, optional: true }] },
    AsyncExportService,
    AsyncExportInterceptor,
  ],
  exports: [AsyncExportService, AsyncExportInterceptor],
})
export class AsyncExportModule {}

export { AsyncExport, ASYNC_EXPORT_META, type AsyncExportOptions } from '@aipowersalon/permissions/guards';
