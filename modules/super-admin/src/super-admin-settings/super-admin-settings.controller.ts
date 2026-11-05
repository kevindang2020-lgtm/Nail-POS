// super-admin-settings.controller.ts — Super Admin → System Settings → General Settings (platform-wide config).
// SuperAdminGuard (super-admin only) + granular super_admin.general_settings.* permissions via the global RolePermissionGuard.
import { SuperAdminGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Post, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { SuperAdminSettingsService, SettingsError, type AdminCtx } from './super-admin-settings.service';
import { SuperAdminSettingsControllerListQueries } from './super-admin-settings.list-queries';
import { SETTINGS_OPERATION_BODY, SETTINGS_RESET_BODY, SETTINGS_SAVE_BODY } from '../request-schemas-ops';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx { const c = req?.ctx || {}; return { userId: c.userId, email: c.email, role: c.role, ip: safeInet(req?.ip) ?? undefined }; }

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e instanceof SettingsError) {
      const status = e.code === 'not_found' ? 404 : e.code === 'forbidden' ? 403 : e.code === 'conflict' ? 409 : 400;
      throw new HttpException({ error: e.code, message: e.message }, status);
    }
    throw e;
  }
}

@ListQueries(SuperAdminSettingsControllerListQueries)
@Controller('super-admin/settings/general')
@UseGuards(SuperAdminGuard)
export class SuperAdminSettingsController {
  constructor(private readonly svc: SuperAdminSettingsService) {}

  /** Effective platform settings, grouped. */
  @Get() @RequirePermission('super_admin.general_settings.view')
  get() { return this.svc.getSettings(); }

  /** The 8 platform summary cards. */
  @Get('overview') @RequirePermission('super_admin.general_settings.view')
  overview() { return this.svc.getOverview(); }

  /** Save changed settings. Body: { changes: [{ key, value, expectedVersion?, reason? }] }. */
  @Post('save') @RequirePermission('super_admin.general_settings.edit')
  save(@Req() req: any, @Body(ValidatedBody(SETTINGS_SAVE_BODY)) b: any) { return run(() => this.svc.saveSettings(ctxFrom(req), b?.changes || [])); }

  /** Reset all settings to code defaults. Body: { confirm: 'RESET' }. Sensitive — separate permission. */
  @Post('reset') @RequirePermission('super_admin.general_settings.reset')
  reset(@Req() req: any, @Body(ValidatedBody(SETTINGS_RESET_BODY)) b: any) { return run(() => this.svc.resetToDefaults(ctxFrom(req), String(b?.confirm || ''))); }

  /** Operational Quick Actions. Body: { op: 'cache_clear' | 'search_reindex' | 'email_test' }. */
  @Post('operations') @RequirePermission('super_admin.general_settings.edit')
  operations(@Req() req: any, @Body(ValidatedBody(SETTINGS_OPERATION_BODY)) b: any) { return run(() => this.svc.operation(ctxFrom(req), String(b?.op || ''))); }

  /** Recent configuration changes (immutable history). */
  @Get('history') @RequirePermission('super_admin.general_settings.view')
  history(@Query() q: any) { const n = Number(q?.limit); return this.svc.recentChanges(Number.isFinite(n) ? n : 20); }

  @Get('history/series') @RequirePermission('super_admin.general_settings.view')
  historySeries(@Query() q: any) { const d = Number(q?.days); return this.svc.changesSeries(Number.isFinite(d) ? d : 7); }

  @Get('localization-distribution') @RequirePermission('super_admin.general_settings.view')
  localizationDistribution() { return this.svc.localizationDistribution(); }

  @Get('adoption-rate') @RequirePermission('super_admin.general_settings.view')
  adoptionRate() { return this.svc.adoptionRate(); }
}
