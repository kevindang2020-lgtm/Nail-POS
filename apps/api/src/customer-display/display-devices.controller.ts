// display-devices.controller.ts — 23-inch dual-screen spec §9–§10, §81–§86: the POS side of the customer displays.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant, branch and user come from the signed session (req.ctx).
//   pos.customer_display.operate (the front desk — the checkout capability): see the branch's displays and registers,
//     Refresh Display (§82)
//   pos.customer_display.manage (the owner — settings.edit): pair by code, rename, dedicate to a register or share,
//     maintenance, revoke, registers (§86)
import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { hasPermission } from '@aipowersalon/permissions';
import { RequirePermission, RolePermissionGuard, TenantAuthGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DisplayDeviceError, DisplayDevicesService, type DisplayStaffCtx } from './display-devices.service';
import { POS_DISPLAY_PAIR_BODY, POS_DISPLAY_STATION_BODY, POS_DISPLAY_UPDATE_BODY } from './request-schemas';

const STATUS: Record<DisplayDeviceError['code'], number> = {
  forbidden: HttpStatus.FORBIDDEN, not_found: HttpStatus.NOT_FOUND, invalid: HttpStatus.BAD_REQUEST, conflict: HttpStatus.CONFLICT,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS, unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};
export async function runDisplayDevice<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DisplayDeviceError) throw new HttpException({ message: e.message, error: e.code }, STATUS[e.code]);
    throw e;
  }
}

function ctxFrom(req: any): DisplayStaffCtx {
  const c = req?.ctx || {};
  const ctx: DisplayStaffCtx = { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId ?? '', role: c.role ?? '', permissions: c.permissions || [] };
  // the POS hides what this user cannot do; the server still refuses it (every manage route below is manage-guarded)
  ctx.canManage = hasPermission({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions } as Parameters<typeof hasPermission>[0], 'pos.customer_display.manage');
  return ctx;
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/customer-displays')
export class DisplayDevicesController {
  constructor(private readonly svc: DisplayDevicesService) {}

  @Get() @RequirePermission('pos.customer_display.operate')
  list(@Req() r: any) { return runDisplayDevice(() => this.svc.list(ctxFrom(r))); }

  @Post('pair') @RequirePermission('pos.customer_display.manage')
  pair(@Req() r: any, @Body(ValidatedBody(POS_DISPLAY_PAIR_BODY)) b: any) { return runDisplayDevice(() => this.svc.pair(ctxFrom(r), b)); }

  // registers (before ':deviceId' so 'stations' is never read as a display id)
  @Post('stations') @RequirePermission('pos.customer_display.manage')
  createStation(@Req() r: any, @Body(ValidatedBody(POS_DISPLAY_STATION_BODY)) b: any) { return runDisplayDevice(() => this.svc.createStation(ctxFrom(r), b)); }

  @Patch('stations/:stationId') @RequirePermission('pos.customer_display.manage')
  renameStation(@Req() r: any, @Param('stationId') id: string, @Body(ValidatedBody(POS_DISPLAY_STATION_BODY)) b: any) { return runDisplayDevice(() => this.svc.renameStation(ctxFrom(r), id, b)); }

  @Delete('stations/:stationId') @RequirePermission('pos.customer_display.manage')
  retireStation(@Req() r: any, @Param('stationId') id: string) { return runDisplayDevice(() => this.svc.retireStation(ctxFrom(r), id)); }

  @Patch(':deviceId') @RequirePermission('pos.customer_display.manage')
  update(@Req() r: any, @Param('deviceId') id: string, @Body(ValidatedBody(POS_DISPLAY_UPDATE_BODY)) b: any) { return runDisplayDevice(() => this.svc.update(ctxFrom(r), id, b)); }

  @Post(':deviceId/revoke') @RequirePermission('pos.customer_display.manage')
  revoke(@Req() r: any, @Param('deviceId') id: string) { return runDisplayDevice(() => this.svc.revoke(ctxFrom(r), id)); }

  @Post(':deviceId/refresh') @RequirePermission('pos.customer_display.operate')
  refresh(@Req() r: any, @Param('deviceId') id: string) { return runDisplayDevice(() => this.svc.refresh(ctxFrom(r), id)); }
}
