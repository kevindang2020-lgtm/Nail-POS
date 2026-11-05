// utilization.controller.ts — read-only plan utilization across active tenants (under SuperAdminGuard). Reuses the
// entitlement engine's resolved used/effective per metric; no mutation.
import { Controller, Get, Post, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { EntitlementsService, EntitlementForbiddenError } from './entitlements.service';

@UseGuards(SuperAdminGuard)
@Controller('super-admin/plans/utilization')
export class UtilizationController {
  constructor(private readonly ent: EntitlementsService) {}

  @Get()
  async utilization() {
    return this.ent.getPlanUtilization();
  }

  @Get('trend')
  async trend() {
    return this.ent.getUtilizationTrend(30);
  }

  @Post('snapshot')
  async snapshot(@Req() req: any) {
    const actor = { userId: req?.ctx?.userId, role: req?.ctx?.role, permissions: req?.ctx?.permissions ?? [] };
    try { return await this.ent.snapshotUtilization(actor); }
    catch (e: any) {
      if (e instanceof EntitlementForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
      throw new HttpException(e?.message || 'Snapshot failed', HttpStatus.BAD_REQUEST);
    }
  }
}
