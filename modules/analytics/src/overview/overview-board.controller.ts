// overview-board.controller.ts — GET /pos/overview/board (supplemental Overview modules). Same guards/permission
// as the canonical Overview surface; tenant scope from the session (never the client).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { OverviewBoardService } from './overview-board.service';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/overview')
export class OverviewBoardController {
  constructor(private readonly board: OverviewBoardService) {}

  @Get('board')
  @RequirePermission('pos.overview.view')
  getBoard(@Req() req: any) {
    const c = req?.ctx || {};
    return this.board.getBoard({ tenantId: c.tenantId, branchId: c.branchId ?? '' });
  }
}
