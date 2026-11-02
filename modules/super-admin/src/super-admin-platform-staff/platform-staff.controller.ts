// platform-staff.controller.ts — Constitution 7 §24: the platform's own staff and their roles.
// Listing needs super_admin.users.view; changing a role needs super_admin.platform_roles.manage (held only by
// PLATFORM_SUPER_ADMIN) and passes the grant-ceiling, no-self-change and last-Super-Admin rules in platform-staff-core.
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Inject, NotFoundException, OnModuleInit, Optional, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PLATFORM_ROLE_CHANGE, platformApprovalsFrom, registerOnce, pendingAnswer } from './platform-admin-approvals';   // Security Deep Scan §134
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { KyselyPlatformStaffRepository } from './platform-staff.repository';
import { PS_REASON_BODY, PS_ROLE_BODY, PS_STATUS_BODY } from '../request-schemas-platform';   // BUILD_PLAN Phase 12 (#17)

@UseGuards(SuperAdminGuard)
@Controller('super-admin/platform-staff')
export class PlatformStaffController implements OnModuleInit {
  constructor(@Optional() @Inject(KyselyPlatformStaffRepository) private readonly repo: KyselyPlatformStaffRepository | null, @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef | null) {}

  /** §134: a platform role change is an approvable action (policy default off); registered at boot so an approval filed
   *  before a restart still executes. On approval it runs for the requester within the approver's permissions, same rules. */
  onModuleInit(): void {
    registerOnce(platformApprovalsFrom(this.moduleRef), PLATFORM_ROLE_CHANGE, 'Change a platform account\'s role', async (p: any, actor) => {
      if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
      const d = await this.repo.changeRole({ userId: String(actor.userId ?? ''), permissions: [...actor.permissions] }, String(p?.userId ?? ''), String(p?.platformRole ?? ''), String(p?.reason ?? ''));
      if (!d.ok) this.fail(d);
      return { ok: true, userId: p.userId, from: d.from, to: d.to, sessionsRevoked: true };
    });
  }

  @Get() @RequirePermission('super_admin.users.view')
  async list() {
    if (!this.repo) return { rows: [] };
    return { rows: await this.repo.list() };
  }

  @RequireStepUp()   // Constitution 7 §8: changing platform permissions
  @Post(':userId/role') @RequirePermission('super_admin.platform_roles.manage')
  // The body names the role to GIVE the target (`platformRole`) — never the caller's own authority, which comes only from
  // the signed session (req.ctx). Named platformRole, not `role`, so it cannot be mistaken for the caller's role (§323).
  async changeRole(@Param('userId') userId: string, @Body(ValidatedBody(PS_ROLE_BODY, { strict: true })) b: { platformRole?: string; reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const actor = { userId: String(req?.ctx?.userId ?? ''), permissions: (req?.ctx?.permissions ?? []) as string[] };
    // §134: with dual approval on for this action, file it for a second platform administrator instead of running it
    const approvals = platformApprovalsFrom(this.moduleRef);
    if (approvals && await approvals.required(PLATFORM_ROLE_CHANGE)) {
      const out = await approvals.runOrRequest(PLATFORM_ROLE_CHANGE, { userId: String(userId), platformRole: String(b?.platformRole ?? ''), reason: String(b?.reason ?? '') }, String(b?.reason ?? ''), actor, String(userId));
      if (!out.executed) return pendingAnswer(out.approvalId, out.expiresAt);
      return out.result;
    }
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
  async changeStatus(@Param('userId') userId: string, @Body(ValidatedBody(PS_STATUS_BODY, { strict: true })) b: { status?: string; reason?: string }, @Req() req: any) {
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
  async revokeSessions(@Param('userId') userId: string, @Body(ValidatedBody(PS_REASON_BODY, { strict: true })) b: { reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const d = await this.repo.revokeSessions(this.actor(req), String(userId), String(b?.reason ?? ''));
    if (!d.ok) this.fail(d);
    return d;
  }

  /** §24 Reset MFA through a secure workflow (step-up; reason; audited). Returns a one-time recovery link ONCE. */
  @RequireStepUp()
  @Post(':userId/reset-mfa') @RequirePermission('super_admin.platform_roles.manage')
  async resetMfa(@Param('userId') userId: string, @Body(ValidatedBody(PS_REASON_BODY, { strict: true })) b: { reason?: string }, @Req() req: any) {
    if (!this.repo) throw new ConflictException('Platform staff changes need a database.');
    const d = await this.repo.resetMfa(this.actor(req), String(userId), String(b?.reason ?? ''));
    if (!d.ok) this.fail(d);
    return { ok: true, recoveryPath: `/mfa-recovery?token=${d.token}`, expiresAt: d.expiresAt,
      note: 'Send this link to the user privately. It works once, for 24 hours, and only together with their own password.' };
  }
}
