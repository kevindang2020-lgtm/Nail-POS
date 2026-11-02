// tenant-presets.controller.ts — Super Admin › General Settings › Tenant Presets.
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { TenantPresetsService, PresetError, type AdminCtx } from './tenant-presets.service';
import { TenantPresetsControllerListQueries } from './tenant-presets.list-queries';
import { PRESET_CREATE_BODY, PRESET_UPDATE_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { const c = req?.ctx || {}; return { userId: c.userId, email: c.email, role: c.role, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof PresetError) { const s = e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : 400; throw new HttpException({ error: e.code, message: e.message }, s); } throw e; }
}

@ListQueries(TenantPresetsControllerListQueries)
@Controller('super-admin/settings/general/tenant-presets')
@UseGuards(SuperAdminGuard)
export class TenantPresetsController {
  constructor(private readonly svc: TenantPresetsService) {}

  @Get() @RequirePermission('super_admin.general_settings.tenant_presets.view')
  list(@Query() q: any) { return this.svc.tableRows(); }

  @Get('defaults') @RequirePermission('super_admin.general_settings.tenant_presets.view')
  defaults() { return this.svc.defaultsByScope(); }

  @Get(':id') @RequirePermission('super_admin.general_settings.tenant_presets.view')
  getOne(@Param('id') id: string) { return run(() => this.svc.get(id)); }

  @Post() @RequirePermission('super_admin.general_settings.tenant_presets.manage')
  create(@Req() req: any, @Body(ValidatedBody(PRESET_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(req), b || {})); }

  @Post(':id/update') @RequirePermission('super_admin.general_settings.tenant_presets.manage')
  update(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(PRESET_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.update(ctxFrom(req), id, b || {})); }

  @Post(':id/make-default') @RequirePermission('super_admin.general_settings.tenant_presets.manage')
  makeDefault(@Req() req: any, @Param('id') id: string) { return run(() => this.svc.makeDefault(ctxFrom(req), id)); }
}
