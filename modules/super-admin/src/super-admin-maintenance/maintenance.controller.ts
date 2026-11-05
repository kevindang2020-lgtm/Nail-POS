// maintenance.controller.ts — Super Admin › General Settings › Maintenance & Messaging.
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { MaintenanceService, MaintError, type AdminCtx } from './maintenance.service';
import { MaintenanceControllerListQueries } from './maintenance.list-queries';
import { MAINT_BANNER_BODY, MAINT_ENABLE_BODY, MAINT_SCHEDULE_BODY } from '../request-schemas-programs';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { const c = req?.ctx || {}; return { userId: c.userId, email: c.email, role: c.role, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof MaintError) { const s = e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : 400; throw new HttpException({ error: e.code, message: e.message }, s); } throw e; }
}

@ListQueries(MaintenanceControllerListQueries)
@Controller('super-admin/settings/general/maintenance')
@UseGuards(SuperAdminGuard)
export class MaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  @Get() @RequirePermission('super_admin.general_settings.maintenance.view')
  state() { return this.svc.getState(); }

  @Get('history') @RequirePermission('super_admin.general_settings.maintenance.view')
  history(@Query() q: any) { const n = Number(q?.limit); return this.svc.history(Number.isFinite(n) ? n : 20); }

  @Post('enable') @RequirePermission('super_admin.general_settings.maintenance.manage')
  enable(@Req() req: any, @Body(ValidatedBody(MAINT_ENABLE_BODY)) b: any) { return run(() => this.svc.enable(ctxFrom(req), b || {})); }

  @Post('disable') @RequirePermission('super_admin.general_settings.maintenance.manage')
  disable(@Req() req: any) { return run(() => this.svc.disable(ctxFrom(req))); }

  @Post('schedule') @RequirePermission('super_admin.general_settings.maintenance.manage')
  schedule(@Req() req: any, @Body(ValidatedBody(MAINT_SCHEDULE_BODY)) b: any) { return run(() => this.svc.schedule(ctxFrom(req), b || {})); }

  @Post('schedule/:id/cancel') @RequirePermission('super_admin.general_settings.maintenance.manage')
  cancel(@Req() req: any, @Param('id') id: string) { return run(() => this.svc.cancel(ctxFrom(req), id)); }

  @Post('banner') @RequirePermission('super_admin.general_settings.maintenance.manage')
  banner(@Req() req: any, @Body(ValidatedBody(MAINT_BANNER_BODY)) b: any) { return run(() => this.svc.setBanner(ctxFrom(req), String(b?.text || ''))); }
}
