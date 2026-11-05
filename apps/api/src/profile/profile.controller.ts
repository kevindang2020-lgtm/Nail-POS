// profile.controller.ts — GET /pos/me/profile, PATCH /pos/me/avatar, DELETE /pos/me/avatar.
// Behind TenantAuthGuard. Scope (tenantId, userId) comes from the session context, so each user
// only ever reads or edits their own row. BUILD_PLAN Phase 9: every route declares a key — the self-service ones
// self.profile.view / self.profile.edit / self.notifications (every staff role holds them); the salon-wide billing
// summary and backup status are settings.view and requesting a backup is settings.edit (they were open to every staff
// role, technicians included, and no client calls them).
import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RequirePermission, TenantAuthGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { ProfileService, AvatarError } from './profile.service';
import { AVATAR_BODY, LOGIN_ALERTS_BODY, NOTIFICATION_PREFS_BODY, UI_PREFS_BODY } from './request-schemas';

@UseGuards(TenantAuthGuard)
@Controller('pos/me')
export class ProfileController {
  constructor(private readonly svc: ProfileService) {}

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
  updateLoginAlerts(@Req() req: any, @Body(ValidatedBody(LOGIN_ALERTS_BODY)) body: any) {
    const c = req?.ctx || {};
    return this.svc.updateLoginAlerts({ tenantId: c.tenantId, userId: c.userId, role: c.role }, body);
  }

  @RequirePermission('self.notifications') @Get('notification-prefs')
  getNotificationPrefs(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getNotificationPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.notifications') @Patch('notification-prefs')
  updateNotificationPrefs(@Req() req: any, @Body(ValidatedBody(NOTIFICATION_PREFS_BODY)) body: any) {
    const c = req?.ctx || {};
    return this.svc.updateNotificationPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role }, body);
  }

  @RequirePermission('self.profile.view') @Get('ui-prefs')
  getUiPrefs(@Req() req: any) {
    const c = req?.ctx || {};
    return this.svc.getUiPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role });
  }

  @RequirePermission('self.profile.edit') @Patch('ui-prefs')
  updateUiPrefs(@Req() req: any, @Body(ValidatedBody(UI_PREFS_BODY)) body: any) {
    const c = req?.ctx || {};
    return this.svc.updateUiPrefs({ tenantId: c.tenantId, userId: c.userId, role: c.role }, body);
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
  async setAvatar(@Req() req: any, @Body(ValidatedBody(AVATAR_BODY)) body: any) {
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
