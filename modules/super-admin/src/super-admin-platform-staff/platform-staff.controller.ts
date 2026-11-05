// platform-staff.controller.ts — Constitution 7 §24: the platform's own staff and their roles.
// Listing needs super_admin.users.view; changing a role needs super_admin.platform_roles.manage (held only by
// PLATFORM_SUPER_ADMIN) and passes the grant-ceiling, no-self-change and last-Super-Admin rules in platform-staff-core.
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { KyselyPlatformStaffRepository } from './platform-staff.repository';
import { PS_REASON_BODY, PS_ROLE_BODY, PS_STATUS_BODY } from '../request-schemas-platform';   // BUILD_PLAN Phase 12 (#17)

@UseGuards(SuperAdminGuard)
@Controller('super-admin/platform-staff')
export class PlatformStaffController {
  constructor(@Optional() @Inject(KyselyPlatformStaffRepository) private readonly repo: KyselyPlatformStaffRepository | null) {}

  @Get() @RequirePermission('super_admin.users.view')
  async list() {
    if (!this.repo) return { rows: [] };
    return { rows: await this.repo.list() };
  }

  @RequireStepUp()   // Constitution 7 §8: changing platform permissions
  @Post(':userId/role') @RequirePermission('super_admin.platform_roles.manage')
  // The body names the role to GIVE the target (`platformRole`) — never the caller's own authority, which comes only from
  // the signed session (req.ctx). Named platformRole, not `role`, so it cannot be mistaken for the caller's role (§323).
  async changeRole(@Param('userId') userId: string, @Body(ValidatedBody(PS_ROLE_BODY)) b: { platformRole?: string; reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const actor = { userId: String(req?.ctx?.userId ?? ''), permissions: (req?.ctx?.permissions ?? []) as string[] };
    const d = await this.repo.changeRole(actor, String(userId), String(b?.platformRole ?? ''), String(b?.reason ?? ''));
    if (d.ok) return { ok: true, userId, from: d.from, to: d.to, sessionsRevoked: true };
    const E = d.status === 400 ? BadRequestException : d.status === 404 ? NotFoundException : d.status === 409 ? ConflictException : ForbiddenException;
    throw new E({ code: d.code, message: d.message });
  }

  private fail(d: { status: number; code: string; message: string }): never {
    const E = d.status === 400 ? BadRequestException : d.status === 404 ? NotFoundException : d.status === 409 ? ConflictException : ForbiddenException;
    throw new E({ code: d.code, message: d.message });
  }
  private actor(req: any) { return { userId: String(req?.ctx?.userId ?? ''), permissions: (req?.ctx?.permissions ?? []) as string[] }; }

  /** §24 Suspend / Activate a platform account (step-up; reason; last Super Admin protected; suspension signs them out). */
  @RequireStepUp()
  @Post(':userId/status') @RequirePermission('super_admin.platform_roles.manage')
  async changeStatus(@Param('userId') userId: string, @Body(ValidatedBody(PS_STATUS_BODY)) b: { status?: string; reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const d = await this.repo.changeStatus(this.actor(req), String(userId), String(b?.status ?? ''), String(b?.reason ?? ''));
    if (!d.ok) this.fail(d);
    return { ok: true, userId, from: d.from, to: d.to };
  }

  /** §24 View Sessions. */
  @Get(':userId/sessions') @RequirePermission('super_admin.users.view')
  async sessions(@Param('userId') userId: string) {
    if (!this.repo) return { rows: [] };
    return { rows: await this.repo.sessions(String(userId)) };
  }

  /** §24 Revoke Sessions (step-up; reason; audited). */
  @RequireStepUp()
  @Post(':userId/revoke-sessions') @RequirePermission('super_admin.platform_roles.manage')
  async revokeSessions(@Param('userId') userId: string, @Body(ValidatedBody(PS_REASON_BODY)) b: { reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const d = await this.repo.revokeSessions(this.actor(req), String(userId), String(b?.reason ?? ''));
    if (!d.ok) this.fail(d);
    return d;
  }

  /** §24 Reset MFA through a secure workflow (step-up; reason; audited). Returns a one-time recovery link ONCE. */
  @RequireStepUp()
  @Post(':userId/reset-mfa') @RequirePermission('super_admin.platform_roles.manage')
  async resetMfa(@Param('userId') userId: string, @Body(ValidatedBody(PS_REASON_BODY)) b: { reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const d = await this.repo.resetMfa(this.actor(req), String(userId), String(b?.reason ?? ''));
    if (!d.ok) this.fail(d);
    return { ok: true, recoveryPath: `/mfa-recovery?token=${d.token}`, expiresAt: d.expiresAt,
      note: 'Send this link to the user privately. It works once, for 24 hours, and only together with their own password.' };
  }
}
