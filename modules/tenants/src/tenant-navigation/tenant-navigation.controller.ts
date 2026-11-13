import { RequirePermission } from '@aipowersalon/permissions/guards';
// tenant-navigation.controller.ts — sidebar endpoints (tenant-session scoped via TenantContextMiddleware).
import { Body, Controller, Get, HttpException, Post, Query, Req } from '@nestjs/common';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { ListQuery } from '@aipowersalon/database';
import type { BadgeSyncMonitor, BadgeSyncRecorded, StaffAlertList, StaffAlertMarkReadResponse } from '@aipowersalon/api-contracts/tenant';
import { TenantNavigationService, type NavCtx } from './tenant-navigation.service';
import { StaffAlertReadError } from './staff-alert-reads';
import { ALERT_READ_BODY, BADGE_SYNC_BODY } from '../request-schemas';

function ctxFrom(r: any): NavCtx {
  const c = r?.ctx || {};
  return { tenantId: c.tenantId || '', branchId: c.branchId || '', role: c.role || '', permissions: c.permissions || [], userId: c.userId || '', sessionId: r?.sessionId ? String(r.sessionId) : null };
}
function run<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => { if (e instanceof StaffAlertReadError) throw new HttpException({ code: e.code, message: e.message }, e.status); throw e; });
}

@Controller('tenant')
export class TenantNavigationController {
  constructor(private readonly svc: TenantNavigationService) {}
  @RequirePermission('dashboard.view') @Get('navigation') navigation(@Req() r: any) { return this.svc.navigation(ctxFrom(r)); }
  @RequirePermission('dashboard.view') @Get('navigation/badges') badges(@Req() r: any) { return this.svc.badges(ctxFrom(r)); }
  // extras round 9 — per-person alert read state (AI BUSINESS ALERTS 05, Global Loyalty Rewards 08) and the cross-device
  // badge-sync monitor (Customer Notifications 04). A read is MY "seen"; it never acknowledges or resolves the alert.
  @RequirePermission('owner.alerts.view') @Get('notifications/alerts') @ListQuery({ filters: { category: { type: 'text', maxLength: 40 } }, search: false, maxLimit: 50, defaultLimit: 20 })
  staffAlerts(@Req() r: any, @Query('category') category?: string, @Query('limit') limit?: string): Promise<StaffAlertList> { return run(() => this.svc.staffAlerts(ctxFrom(r), { category: category ?? null, limit: limit ? Number(limit) : undefined })); }
  @RequirePermission('owner.alerts.view') @Post('notifications/alerts/read')
  markAlertsRead(@Req() r: any, @Body(ValidatedBody(ALERT_READ_BODY, { strict: true })) b: { alertIds: string[] }): Promise<StaffAlertMarkReadResponse> { return run(() => this.svc.markAlertsRead(ctxFrom(r), b?.alertIds)); }
  @RequirePermission('dashboard.view') @Post('navigation/badges/sync')
  recordBadgeSync(@Req() r: any, @Body(ValidatedBody(BADGE_SYNC_BODY, { strict: true })) b: { unread: number; surface?: string }): Promise<BadgeSyncRecorded> { return run(() => this.svc.recordBadgeSync(ctxFrom(r), b ?? {})); }
  @RequirePermission('dashboard.view') @Get('navigation/badge-sync')
  badgeSyncMonitor(@Req() r: any): Promise<BadgeSyncMonitor> { return run(() => this.svc.badgeSyncMonitor(ctxFrom(r))); }
  @RequirePermission('dashboard.view') @Get('system-status') systemStatus() { return this.svc.systemStatus(); }
  @RequirePermission('help.view') @Get('help/dashboard') helpDashboard(@Req() r: any) { return this.svc.helpDashboard(ctxFrom(r)); }
}
