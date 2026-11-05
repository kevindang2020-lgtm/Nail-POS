// business-categories.controller.ts — Super Admin › General Settings › Business Categories.
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { BusinessCategoriesService, BizCatError, type AdminCtx } from './business-categories.service';
import { BusinessCategoriesControllerListQueries } from './business-categories.list-queries';
import { BIZ_CATEGORY_CREATE_BODY, BIZ_CATEGORY_RENAME_BODY, BIZ_CATEGORY_REORDER_BODY } from '../request-schemas-catalog';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { const c = req?.ctx || {}; return { userId: c.userId, email: c.email, role: c.role, ip: safeInet(req?.ip) ?? undefined }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if (e instanceof BizCatError) { const s = e.code === 'not_found' ? 404 : e.code === 'conflict' ? 409 : 400; throw new HttpException({ error: e.code, message: e.message }, s); } throw e; }
}

@ListQueries(BusinessCategoriesControllerListQueries)
@Controller('super-admin/settings/general/business-categories')
@UseGuards(SuperAdminGuard)
export class BusinessCategoriesController {
  constructor(private readonly svc: BusinessCategoriesService) {}

  @Get() @RequirePermission('super_admin.general_settings.business_categories.view')
  list(@Query() q: any) { return this.svc.list(String(q?.includeInactive) === 'true'); }

  @Get('summary') @RequirePermission('super_admin.general_settings.business_categories.view')
  summary() { return this.svc.summary(); }

  @Post() @RequirePermission('super_admin.general_settings.business_categories.manage')
  create(@Req() req: any, @Body(ValidatedBody(BIZ_CATEGORY_CREATE_BODY)) b: any) { return run(() => this.svc.create(ctxFrom(req), b || {})); }

  @Post('reorder') @RequirePermission('super_admin.general_settings.business_categories.manage')
  reorder(@Req() req: any, @Body(ValidatedBody(BIZ_CATEGORY_REORDER_BODY)) b: any) { return run(() => this.svc.reorder(ctxFrom(req), b?.orderedIds || [])); }

  @Post(':id/rename') @RequirePermission('super_admin.general_settings.business_categories.manage')
  rename(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(BIZ_CATEGORY_RENAME_BODY)) b: any) { return run(() => this.svc.rename(ctxFrom(req), id, String(b?.name || ''))); }

  @Post(':id/activate') @RequirePermission('super_admin.general_settings.business_categories.manage')
  activate(@Req() req: any, @Param('id') id: string) { return run(() => this.svc.setActive(ctxFrom(req), id, true)); }

  @Post(':id/deactivate') @RequirePermission('super_admin.general_settings.business_categories.manage')
  deactivate(@Req() req: any, @Param('id') id: string) { return run(() => this.svc.setActive(ctxFrom(req), id, false)); }
}
