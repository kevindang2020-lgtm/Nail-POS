// tenant-activity.controller.ts — SUPER_ADMIN-guarded HTTP surface for the faceted Tenant Activity page.
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SuperAdminTenantActivityService } from './tenant-activity.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminTenantActivityControllerListQueries } from './tenant-activity.list-queries';

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminTenantActivityControllerListQueries)
@Controller('super-admin/tenant-activity')
export class SuperAdminTenantActivityController {
  constructor(private readonly svc: SuperAdminTenantActivityService) {}

  @Get('recent') recent(@Query() q: any) { return this.svc.recent(q); }
  @Get('summary') summary(@Query() q: any) { return this.svc.summary(q); }
  @Get(':activityId') byId(@Param('activityId') id: string) { return this.svc.byId(id); }
  @Get() list(@Query() q: any) { return this.svc.list(q); }
}
