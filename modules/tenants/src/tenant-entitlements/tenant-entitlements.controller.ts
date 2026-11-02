// tenant-entitlements.controller.ts — tenant self-service view of its OWN plan limits + current usage
// (GET /tenant/account/usage-limits/state, settings.view). Reuses EntitlementsService.getEntitlements for
// the caller's server-derived tenant; never accepts a tenantId from the client. Read-only.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { EntitlementsService } from '@aipowersalon/platform';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('tenant/account/usage-limits')
export class TenantEntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}
  @Get('state') @RequirePermission('settings.view')
  async state(@Req() r: any) {
    const c = r?.ctx || {};
    if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.FORBIDDEN), 'PERMISSION_DENIED');
    return this.entitlements.getEntitlements(c.tenantId);
  }
}
