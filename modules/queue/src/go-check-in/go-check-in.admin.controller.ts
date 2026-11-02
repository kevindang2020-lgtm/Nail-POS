// go-check-in.admin.controller.ts — Super Admin device management + logs (per tenant).
// go-check-in.settings.controller.ts — tenant POS settings for Go Check-In.
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { GO_ADMIN_SETTINGS_BODY, GO_DEVICE_CREATE_BODY, GO_DEVICE_UPDATE_BODY, GO_POS_SETTINGS_BODY } from '../request-schemas';
import type { GoCheckInDevicesState } from '@aipowersalon/api-contracts/tenant';
import { SuperAdminGuard, TenantAuthGuard, RolePermissionGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, HttpException } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { GoCheckInService, GoCheckInError } from './go-check-in.service';
import { ListQueries } from '@aipowersalon/database';
import { GoCheckInAdminControllerListQueries } from './go-check-in.admin.list-queries';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof GoCheckInError) throw new HttpException({ message: e.message, code: e.code }, e.status); throw e; }
}

// -------------------- Super Admin: device management --------------------
@UseGuards(SuperAdminGuard)
@ListQueries(GoCheckInAdminControllerListQueries)
@Controller('super-admin/tenants/:tenantId/go-check-in')
export class GoCheckInAdminController {
  constructor(private readonly svc: GoCheckInService) {}

  // list devices + current settings for the tenant
  @Get() list(@Param('tenantId') tenantId: string) { return run(async (): Promise<GoCheckInDevicesState> => ({ ...(await this.svc.listDevices(tenantId)), settings: await this.svc.getSettings(tenantId) })); }

  // create a device (assigns tenant + branch, mints slug + token; token returned ONCE)
  @Post() create(@Param('tenantId') tenantId: string, @Body(ValidatedBody(GO_DEVICE_CREATE_BODY, { strict: true })) b: any, @Req() r: any) {
    return run(() => this.svc.createDevice(tenantId, { deviceName: b?.deviceName, branchId: b?.branchId ?? null, deviceType: b?.deviceType, baseUrl: b?.baseUrl, allowedBranchIds: Array.isArray(b?.allowedBranchIds) ? b.allowedBranchIds : undefined, welcomeMessage: b?.welcomeMessage }, r?.ctx?.userId));
  }

  // update settings (master enable/disable + toggles) for the tenant
  @Patch('settings') patchSettings(@Param('tenantId') tenantId: string, @Body(ValidatedBody(GO_ADMIN_SETTINGS_BODY, { strict: true })) b: any) { return run(() => this.svc.updateSettings(tenantId, b || {})); }

  // update a device (status and/or its default + allowed branches)
  @Patch(':deviceId') update(@Param('tenantId') tenantId: string, @Param('deviceId') deviceId: string, @Body(ValidatedBody(GO_DEVICE_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateDevice(tenantId, deviceId, { status: b?.status, branchId: b?.branchId, allowedBranchIds: Array.isArray(b?.allowedBranchIds) ? b.allowedBranchIds : undefined, welcomeMessage: b?.welcomeMessage })); }

  @Post(':deviceId/regenerate-token') regen(@Param('tenantId') tenantId: string, @Param('deviceId') deviceId: string) { return run(() => this.svc.regenerateToken(tenantId, deviceId)); }
  @Post(':deviceId/disable') disable(@Param('tenantId') tenantId: string, @Param('deviceId') deviceId: string) { return run(() => this.svc.disableDevice(tenantId, deviceId)); }

  @Get('logs') logs(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) { return run(() => this.svc.logs(tenantId, limit ? Number(limit) : 100)); }
}

// -------------------- Tenant POS settings --------------------
@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/settings')
export class GoCheckInSettingsController {
  constructor(private readonly svc: GoCheckInService) {}

  @Get('go-check-in') @RequirePermission('settings.view') get(@Req() r: any) { return run(() => this.svc.getSettings(r?.ctx?.tenantId)); }
  // tenant may tune feature toggles but NOT the master `enabled` switch (Super Admin owns that). A WRITE needs the write
  // permission (Dual-Screen mandate wave, Oct 12 2026: it was guarded by settings.view, so anyone who could see the
  // settings could change the salon's check-in).
  @Patch('go-check-in') @RequirePermission('settings.edit') patch(@Req() r: any, @Body(ValidatedBody(GO_POS_SETTINGS_BODY, { strict: true })) b: any) {
    const { enabled, ...toggles } = b || {};
    return run(() => this.svc.updateSettings(r?.ctx?.tenantId, toggles));
  }
}
