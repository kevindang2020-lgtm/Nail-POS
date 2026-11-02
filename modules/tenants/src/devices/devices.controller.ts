// devices.controller.ts — tenant Devices & Integrations HTTP surface (`/pos/devices/*`).
// Guards: TenantAuthGuard + RolePermissionGuard. tenant/branch/role come from req.ctx (session) — never the body.
// Permission pos.devices.view maps onto the existing settings capability via security-core (reuse, no new grants).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DevicesService, ForbiddenError, ValidationError } from './devices.service';
import type { DevicesContext } from './devices.dto';

function ctxFrom(req: any): DevicesContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/devices')
export class DevicesController {
  constructor(private readonly svc: DevicesService) {}

  @Get('overview') @RequirePermission('pos.devices.view')
  overview(@Req() r: any) { return run(() => this.svc.getOverview(ctxFrom(r))); }
}
