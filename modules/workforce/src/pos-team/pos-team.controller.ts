// pos-team.controller.ts — GET /pos/team: the tenant's user roster + role summary for the Users & Roles screen.
// Gated to settings-capable roles (Owner/Manager); staff roles can't enumerate the team. Read-only.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
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

  // GET member/:userId (the old Team Management drawer) was retired on 30 Oct 2026: the screen reads the user-keyed,
  // tenant + branch scoped profile at /pos/team-members-screen/members/:memberId (and its lazy tabs) instead, and no
  // other screen called it. PosTeamService.getMemberDetail stays (its technician join now carries the tenant).
}
