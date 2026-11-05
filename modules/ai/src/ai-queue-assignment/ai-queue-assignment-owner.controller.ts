// ai-queue-assignment-owner.controller.ts — BUILD_PLAN Phase 6: the Owner app's AI queue branch comparison.
// GET owner/ai-queue-assignment/summary?days= → { days, range, branches: [{ branchId, name, served, avgWaitMinutes,
// longestWaitMinutes, acceptanceRate, staffDecisions, autoAssigned, openAlerts }], totals }. Every location of the salon
// (the owner session needs no location); owner.dashboard.view like the rest of the owner app.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { QueueOpsService } from './ai-queue-assignment-ops.service';
import { opsRun } from './ai-queue-assignment-ops.controller';
import { ListQueries } from '@aipowersalon/database';
import { OwnerQueueAssignmentControllerListQueries } from './ai-queue-assignment-owner.list-queries';

/** owner/ai-queue-assignment — the owner app's branch comparison (every location of the salon; no branch needed). */
@ListQueries(OwnerQueueAssignmentControllerListQueries)
@Controller('owner/ai-queue-assignment')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class OwnerQueueAssignmentController {
  constructor(private readonly ops: QueueOpsService) {}

  @Get('summary') @RequirePermission('owner.dashboard.view')
  summary(@Req() r: any, @Query('days') days?: string) {
    const c = r?.ctx || {};
    return opsRun(() => this.ops.ownerSummary({ tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: c.permissions || [] }, Number(days) || 7));
  }
}
