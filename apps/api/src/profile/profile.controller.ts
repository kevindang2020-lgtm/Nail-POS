// profile.controller.ts — GET /pos/me/profile, PATCH /pos/me/avatar, DELETE /pos/me/avatar.
// Behind TenantAuthGuard. Scope (tenantId, userId) comes from the session context, so each user
// only ever reads or edits their own row. BUILD_PLAN Phase 9: every route declares a key — the self-service ones
// self.profile.view / self.profile.edit / self.notifications (every staff role holds them); the salon-wide billing
// summary and backup status are settings.view and requesting a backup is settings.edit (they were open to every staff
// role, technicians included, and no client calls them).
import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ListQuery } from '@aipowersalon/database';
import type { NotificationDeliveryPage, SavedView, SavedViewDeleted, SavedViewList } from '@aipowersalon/api-contracts/tenant';
import { RequirePermission, TenantAuthGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ProfileService, AvatarError } from './profile.service';
import { SavedViews } from './saved-views';
import { AVATAR_BODY, LOGIN_ALERTS_BODY, NOTIFICATION_PREFS_BODY, SAVED_VIEW_CREATE_BODY, SAVED_VIEW_UPDATE_BODY, UI_PREFS_BODY } from './request-schemas';

@UseGuards(TenantAuthGuard)
@Controller('pos/me')
export class ProfileController {
  constructor(private readonly svc: ProfileService, private readonly views: SavedViews) {}

  @RequirePermission('self.profile.view') @Get('profile')
  getProfile(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.get({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.view') @Get('sessions')
  listSessions(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.listSessions({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.edit') @Post('sessions/:id/revoke')
  revokeSession(@Req() req: any, @Param('id') id: string) {
    const c = req?.ctx || {};
    return this.svc.revokeSession({ tenantId: c.tenantId, userId: c.userId, role: c.role }, id);
  }

  @RequirePermission('self.profile.edit') @Post('sessions/revoke-all')
  revokeAllSessions(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.revokeAllSessions({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.view') @Get('login-alerts')
  getLoginAlerts(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getLoginAlerts({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.edit') @Patch('login-alerts')
  updateLoginAlerts(@Req() req: any, @Body(ValidatedBody(LOGIN_ALERTS_BODY, { strict: true })) body: any) {
    const c = req?.ctx || {};
    return this.svc.updateLoginAlerts({ tenantId: c.tenantId, userId: c.userId, role: c.role }, body);
  }

  // batch 8 decision 7: the user's own alert deliveries (notification_delivery_logs), newest first, server-paged
  @RequirePermission('self.notifications') @Get('notification-deliveries')
  @ListQuery({ filters: { channel: { type: 'enum', values: ['sms', 'email', 'push'] }, status: { type: 'enum', values: ['queued', 'sent', 'delivered', 'failed', 'suppressed', 'blocked'] } },
    sorts: { newest: null }, search: { maxLength: 100 }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page'] } as const)
  notificationDeliveries(@Req() req: any, @Query() q: any): Promise<NotificationDeliveryPage> {
    const c = req?.ctx || {};
    return this.svc.notificationDeliveries({ tenantId: c.tenantId, userId: c.userId, role: c.role }, q ?? {});
  }

  @RequirePermission('self.notifications') @Get('notification-prefs')
  getNotificationPrefs(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getNotificationPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.notifications') @Patch('notification-prefs')
  updateNotificationPrefs(@Req() req: any, @Body(ValidatedBody(NOTIFICATION_PREFS_BODY, { strict: true })) body: any) {
    const c = req?.ctx || {};
    return this.svc.updateNotificationPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role }, body);
  }

  @RequirePermission('self.profile.view') @Get('ui-prefs')
  getUiPrefs(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getUiPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.edit') @Patch('ui-prefs')
  updateUiPrefs(@Req() req: any, @Body(ValidatedBody(UI_PREFS_BODY, { strict: true })) body: any) {
    const c = req?.ctx || {};
    return this.svc.updateUiPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role }, body);
  }

  // POS saved views (Nov 9 2026): the person's own named filters for one screen — keyed by the session, never the body
  @RequirePermission('self.profile.view') @Get('saved-views')
  savedViews(@Req() req: any, @Query('surface') surface: string): Promise<SavedViewList> {
    const c = req?.ctx || {};
    return this.views.list({ tenantId: c.tenantId, userId: c.userId }, surface);
  }

  @RequirePermission('self.profile.edit') @Post('saved-views')
  createSavedView(@Req() req: any, @Body(ValidatedBody(SAVED_VIEW_CREATE_BODY, { strict: true })) body: any): Promise<SavedView> {
    const c = req?.ctx || {};
    return this.views.create({ tenantId: c.tenantId, userId: c.userId }, body);
  }

  @RequirePermission('self.profile.edit') @Patch('saved-views/:id')
  updateSavedView(@Req() req: any, @Param('id') id: string, @Body(ValidatedBody(SAVED_VIEW_UPDATE_BODY, { strict: true })) body: any): Promise<SavedView> {
    const c = req?.ctx || {};
    return this.views.update({ tenantId: c.tenantId, userId: c.userId }, id, body);
  }

  @RequirePermission('self.profile.edit') @Delete('saved-views/:id')
  deleteSavedView(@Req() req: any, @Param('id') id: string): Promise<SavedViewDeleted> {
    const c = req?.ctx || {};
    return this.views.remove({ tenantId: c.tenantId, userId: c.userId }, id);
  }

  @RequirePermission('settings.view') @Get('billing')
  getBilling(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getBillingSummary({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('settings.view') @Get('backup')
  getBackup(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getBackupStatus({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('settings.edit') @Post('backup/run')
  runBackup(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.requestBackup({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.edit') @Patch('avatar')
  async setAvatar(@Req() req: any, @Body(ValidatedBody(AVATAR_BODY, { strict: true })) body: any) {
    const c = req?.ctx || {};
    try {
      return await this.svc.setAvatar({ tenantId: c.tenantId, userId: c.userId }, body?.dataUrl);
    } catch (e) {
      if (e instanceof AvatarError) throw new HttpException(e.message, e.status);
      throw e;
    }
  }

  @RequirePermission('self.profile.edit') @Delete('avatar')
  removeAvatar(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.removeAvatar({ tenantId: c.tenantId, userId: c.userId });
  }
}
