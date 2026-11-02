// dashboard.controller.ts — Super-Admin platform dashboard. GET /super-admin/dashboard → overview metrics. Thin; the
// aggregation + data access live in the service/port. (When the tenant-context middleware + super-admin guard are
// applied per the runbook, this route is restricted to SUPER_ADMIN.)
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminDashboardService } from './dashboard.service';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminDashboardControllerListQueries } from './dashboard.list-queries';

@ListQueries(SuperAdminDashboardControllerListQueries)
@Controller('super-admin/dashboard')
@UseGuards(SuperAdminGuard)
export class SuperAdminDashboardController {
  constructor(private readonly svc: SuperAdminDashboardService) {}

  @Get()
  overview(@Query() q: any) {
    const newWindowDays = q?.newWindowDays != null ? Number(q.newWindowDays) : undefined;
    const usageThresholdPercent = q?.usageThresholdPercent != null ? Number(q.usageThresholdPercent) : undefined;
    return this.svc.getOverview({ newWindowDays, usageThresholdPercent });
  }
}
