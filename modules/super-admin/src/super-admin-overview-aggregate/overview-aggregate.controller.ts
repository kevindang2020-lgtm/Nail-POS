// overview-aggregate.controller.ts — SuperAdminGuard-only. One read-only route returning the composed Overview payload.
import { safeInet, parseScope, ListQueries } from '@aipowersalon/database';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { OverviewAggregateService, type AggCtx } from './overview-aggregate.service';
import type { Range } from '../super-admin-overview/overview.dto';
import { OverviewAggregateControllerListQueries } from './overview-aggregate.list-queries';

function ctxFrom(req: any): AggCtx { return { userId: req?.ctx?.userId, email: req?.ctx?.email, ip: safeInet(req?.ip) ?? undefined }; }
function parseRange(v: unknown): Range { return v === 'day' || v === 'week' || v === 'year' ? v : 'month'; }

@UseGuards(SuperAdminGuard)
@ListQueries(OverviewAggregateControllerListQueries)
@Controller('super-admin/overview')
export class OverviewAggregateController {
  constructor(private readonly svc: OverviewAggregateService) {}

  @Get('aggregate') aggregate(@Req() r: any, @Query('range') range: unknown, @Query('tenantId') tenantId: unknown) {
    return this.svc.aggregate(ctxFrom(r), parseRange(range), parseScope(tenantId));
  }
}
