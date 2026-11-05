// pos-team.controller.ts — GET /pos/team: the tenant's user roster + role summary for the Users & Roles screen.
// Gated to settings-capable roles (Owner/Manager); staff roles can't enumerate the team. Read-only.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { PosTeamService } from './pos-team.service';
import { ListQueries } from '@aipowersalon/database';
import { PosTeamControllerListQueries } from './pos-team.list-queries';

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(PosTeamControllerListQueries)
@Controller('pos/team')
export class PosTeamController {
  constructor(private readonly svc: PosTeamService) {}

  @Get() @RequirePermission('pos.technicians.view')
  list(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.listTeam({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @Get('state') @RequirePermission('pos.technicians.view')
  state(@Req() req: any, @Query() q: any) {
    const c = req?.ctx || {};
    return this.svc.getState({ tenantId: c.tenantId, userId: c.userId, role: c.role }, {
      search: q.search, role: q.role, status: q.status, shift: q.shift, department: q.department, tab: q.tab,
      page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
  }

  @Get('member/:userId') @RequirePermission('pos.technicians.view')
  member(@Req() req: any, @Param('userId') userId: string) {
    const c = req?.ctx || {};
    return this.svc.getMemberDetail({ tenantId: c.tenantId, userId: c.userId, role: c.role }, userId);
  }
}
