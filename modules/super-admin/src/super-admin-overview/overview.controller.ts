// overview.controller.ts — Super-Admin Overview dashboard. SUPER_ADMIN-only (guard). Tenant users get 403.
import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminOverviewService } from './overview.service';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import type { Range } from './overview.dto';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminOverviewControllerListQueries } from './overview.list-queries';

const asRange = (q: any): Range => (['day', 'week', 'month', 'year'].includes(q?.range) ? q.range : 'month');

@ListQueries(SuperAdminOverviewControllerListQueries)
@Controller('super-admin/overview')
@UseGuards(SuperAdminGuard)
export class SuperAdminOverviewController {
  constructor(private readonly svc: SuperAdminOverviewService) {}

  @Get('state')
  state(@Req() r: any, @Query() q: any) {
    return this.svc.getState(asRange(q), r?.ctx?.role ?? null);
  }

  @Get('monthly-sales-volume')
  monthlySales(@Query() q: any) {
    return this.svc.getMonthlySalesVolume(asRange(q));
  }

  @Post('snapshot')
  snapshot() {
    return this.svc.captureSnapshot();
  }
}
