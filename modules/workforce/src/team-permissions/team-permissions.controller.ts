// team-permissions.controller.ts — GET /pos/team/permissions/state (pos.technicians.view). Read-only.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { buildPermissionMatrix } from './team-permissions.dto';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/team/permissions')
export class TeamPermissionsController {
  @Get('state') @RequirePermission('pos.technicians.view')
  state(@Req() r: any) {
    const c = r?.ctx || {};
    if (!c.userId || !c.tenantId) throw withCode(new HttpException('Not authenticated', HttpStatus.FORBIDDEN), 'PERMISSION_DENIED');
    return buildPermissionMatrix();
  }
}
