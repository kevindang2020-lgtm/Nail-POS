// sms-packages.controller.ts — §3/§4/§5: Super Admin package management routes. Guarded twice: SuperAdminGuard
// (role) + RolePermissionGuard (§54 granular keys). Mounted under the existing SA family; the sidebar entry
// lands in P4 with the screens.
import { SuperAdminGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { SmsPackagesService, SmsPackagesError, type AdminCtx } from './sms-packages.service';
import { SmsPlatformControlsService, SmsControlsError } from './sms-platform-controls.service';
import { SMS_CONTROL_BODY, SMS_DEFAULT_PACKAGE_BODY, SMS_PACKAGE_UPDATE_BODY } from '../request-schemas';

function ctxFrom(r: any): AdminCtx { return { userId: r?.ctx?.userId ?? null, ip: r?.ip ?? null }; }

@Controller('super-admin/sms-packages')
@UseGuards(SuperAdminGuard, RolePermissionGuard)
export class SmsPackagesController {
  constructor(private readonly svc: SmsPackagesService, private readonly controls: SmsPlatformControlsService) {}

  private async run<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
    try { return await fn(); } catch (e) {
      if (e instanceof SmsPackagesError) return { ok: false, error: e.code };
      if (e instanceof SmsControlsError) return { ok: false, error: e.code };
      throw e;
    }
  }

  @Get('platform-controls') @RequirePermission('super_admin.sms_packages.view')
  getControls() { return this.run(() => this.controls.getControls()); }

  @RequireStepUp()   // Constitution 7 §34: kill switches need step-up — SMS master controls incl. the emergency send stop
  @Post('platform-controls') @RequirePermission('super_admin.sms_emergency.disable')
  setControl(@Req() r: any, @Body(ValidatedBody(SMS_CONTROL_BODY)) b: any) {
    return this.run(() => this.controls.setControl(ctxFrom(r), String(b?.key ?? ''), b?.enabled === true, String(b?.reason ?? '')));
  }

  @Get('default-package') @RequirePermission('super_admin.sms_packages.view')
  getDefaultPackage() { return this.run(async () => ({ defaultPackageCode: await this.controls.getDefaultPackageCode() })); }

  @Post('default-package') @RequirePermission('super_admin.sms_packages.manage')
  setDefaultPackage(@Req() r: any, @Body(ValidatedBody(SMS_DEFAULT_PACKAGE_BODY)) b: any) {
    return this.run(() => this.controls.setDefaultPackageCode(ctxFrom(r), b?.code ?? null, String(b?.reason ?? '')));
  }

  @Get() @RequirePermission('super_admin.sms_packages.view')
  list() { return this.run(() => this.svc.listPackages()); }

  @Get(':packageId') @RequirePermission('super_admin.sms_packages.view')
  detail(@Param('packageId') id: string) { return this.run(() => this.svc.getPackage(id)); }

  @Patch(':packageId') @RequirePermission('super_admin.sms_packages.manage')
  update(@Req() r: any, @Param('packageId') id: string, @Body(ValidatedBody(SMS_PACKAGE_UPDATE_BODY)) body: Record<string, unknown>) {
    return this.run(() => this.svc.updatePackage(ctxFrom(r), id, body || {}));
  }

  @Post(':packageId/enable') @RequirePermission('super_admin.sms_packages.manage')
  enable(@Req() r: any, @Param('packageId') id: string) { return this.run(() => this.svc.setActive(ctxFrom(r), id, true)); }

  @Post(':packageId/disable') @RequirePermission('super_admin.sms_packages.manage')
  disable(@Req() r: any, @Param('packageId') id: string) { return this.run(() => this.svc.setActive(ctxFrom(r), id, false)); }
}
