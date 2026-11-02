import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { RequirePermission, TenantAuthGuard } from '@aipowersalon/permissions/guards';
import { PosAccountService } from './pos-account.service';

@UseGuards(TenantAuthGuard)
@Controller('pos/account')
export class PosAccountController {
  constructor(private readonly svc: PosAccountService) {}

  @RequirePermission('self.profile.view') @Get('overview')
  async overview(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getOverview({ tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role });
  }
}
