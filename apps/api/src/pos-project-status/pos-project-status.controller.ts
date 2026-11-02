// pos-project-status.controller.ts — tenant POS delivery status (`/pos/project-status`).
// Guards: TenantAuthGuard + RolePermissionGuard. Read access requires pos.reports.view.
// The Super Admin all-tenant view is a separate surface at /super-admin/project-status.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Patch, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { PosProjectStatusService, ForbiddenError, PSContext } from './pos-project-status.service';
import type { POSModuleKey } from './pos-project-status.dto';

function ctxFrom(req: any): PSContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
function run<T>(fn: () => T): T {
  try { return fn(); } catch (e) { if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/project-status')
export class PosProjectStatusController {
  constructor(private readonly svc: PosProjectStatusService) {}

  @Get() @RequirePermission('pos.reports.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Get('modules') @RequirePermission('pos.reports.view')
  modules(@Req() r: any) { return run(() => this.svc.getModules(ctxFrom(r))); }

  @Get('module/:moduleKey') @RequirePermission('pos.reports.view')
  one(@Req() r: any, @Param('moduleKey') moduleKey: string) { return run(() => this.svc.getModule(ctxFrom(r), moduleKey as POSModuleKey)); }

  @Patch('module/:moduleKey/recheck') @RequirePermission('pos.reports.view')
  recheck(@Req() r: any, @Param('moduleKey') moduleKey: string) { return run(() => this.svc.recheck(ctxFrom(r), moduleKey as POSModuleKey)); }
}
