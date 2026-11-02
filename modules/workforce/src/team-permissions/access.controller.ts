// access.controller.ts — BUILD_PLAN Phase 9 (Constitution 2 §roles & permissions screen): the salon's Roles & Permissions
// API. Every route declares its key; the changes that hand out authority need a fresh step-up (Constitution 7 §8 —
// the same StepUpGuard the platform uses, open to every realm since Constitution 3 Step 5).
//   GET  /pos/access/roles                          TeamRoleView[]                [roles.view]
//   GET  /pos/access/members                        TeamMemberView[]              [roles.view]
//   GET  /pos/access/members/:userId                TeamMemberView                [roles.view]
//   PUT  /pos/access/members/:userId/role           TeamAssignRoleRequest         [roles.manage, step-up]
//   PUT  /pos/access/members/:userId/branches       TeamBranchAccessRequest       [branch_access.manage, step-up]
//   POST /pos/access/members/:userId/overrides      TeamOverrideRequest           [permissions.override, step-up]
//   POST /pos/access/overrides/:id/revoke           TeamOverrideRevoke            [permissions.override, step-up]
//   GET  /pos/access/members/:userId/effective      TeamEffectivePermissions      [roles.view]
//   POST /pos/access/preview                        TeamPreviewRequest            [roles.view]
//   GET  /pos/access/audit?userId&page&pageSize     AuthzAuditEventView page      [roles.view]
//   GET  /pos/access/catalog                        PermissionDefinition[]        [roles.view]
//   POST /pos/access/ownership/transfer             OwnershipTransferRequest      [ownership.transfer, step-up]
//   POST /pos/access/members/:userId/end-employment { reason }                  [roles.manage, step-up]   B-13: non-technician staff
import { Body, Controller, Get, HttpException, Inject, Optional, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { TeamAccessService, AccessError, type AccessActor } from './access.service';
import { ListQueries } from '@aipowersalon/database';
import { TeamAccessControllerListQueries } from './access.list-queries';

import { END_EMPLOYMENT_BODY, OWNERSHIP_TRANSFER_BODY, TEAM_ASSIGN_ROLE_BODY, TEAM_BRANCH_ACCESS_BODY, TEAM_OVERRIDE_BODY, TEAM_OVERRIDE_REVOKE_BODY, TEAM_PREVIEW_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
export const TEAM_ACCESS_SERVICE = 'TEAM_ACCESS_SERVICE';
const actorOf = (req: any): AccessActor => { const c = req?.ctx || {}; return { tenantId: c.tenantId, userId: c.userId, role: c.role, permissions: Array.isArray(c.permissions) ? c.permissions : [], ip: typeof req?.ip === 'string' && req.ip ? req.ip : null }; };
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof AccessError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}
const svcOrThrow = (s: TeamAccessService | null | undefined): TeamAccessService => { if (!s) throw new HttpException({ code: 'UNAVAILABLE', message: 'Roles & permissions need a database.' }, 503); return s; };

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(TeamAccessControllerListQueries)
@Controller('pos/access')
export class TeamAccessController {
  constructor(@Optional() @Inject(TEAM_ACCESS_SERVICE) private readonly svc?: TeamAccessService | null) {}

  @Get('roles') @RequirePermission('roles.view')
  roles(@Req() r: any) { return run(() => svcOrThrow(this.svc).listRoles(actorOf(r))); }

  @Get('members') @RequirePermission('roles.view')
  members(@Req() r: any) { return run(() => svcOrThrow(this.svc).listMembers(actorOf(r))); }

  @Get('members/:userId') @RequirePermission('roles.view')
  member(@Req() r: any, @Param('userId') userId: string) { return run(() => svcOrThrow(this.svc).member(actorOf(r), userId)); }

  @Put('members/:userId/role') @RequirePermission('roles.manage') @RequireStepUp()
  assignRole(@Req() r: any, @Param('userId') userId: string, @Body(ValidatedBody(TEAM_ASSIGN_ROLE_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).assignRole(actorOf(r), userId, b ?? {})); }

  @Put('members/:userId/branches') @RequirePermission('branch_access.manage') @RequireStepUp()
  setBranches(@Req() r: any, @Param('userId') userId: string, @Body(ValidatedBody(TEAM_BRANCH_ACCESS_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).setBranchAccess(actorOf(r), userId, b ?? {})); }

  @Post('members/:userId/overrides') @RequirePermission('permissions.override') @RequireStepUp()
  grantOverride(@Req() r: any, @Param('userId') userId: string, @Body(ValidatedBody(TEAM_OVERRIDE_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).grantOverride(actorOf(r), userId, b ?? {})); }

  @Post('overrides/:id/revoke') @RequirePermission('permissions.override') @RequireStepUp()   // Security Deep Scan §59
  revokeOverride(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(TEAM_OVERRIDE_REVOKE_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).revokeOverride(actorOf(r), id, b ?? {})); }

  @Get('members/:userId/effective') @RequirePermission('roles.view')
  effective(@Req() r: any, @Param('userId') userId: string) { return run(() => svcOrThrow(this.svc).effective(actorOf(r), userId)); }

  @Post('preview') @RequirePermission('roles.view')
  preview(@Req() r: any, @Body(ValidatedBody(TEAM_PREVIEW_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).preview(actorOf(r), b ?? {})); }

  @Get('audit') @RequirePermission('roles.view')
  audit(@Req() r: any, @Query() q: any) { return run(() => svcOrThrow(this.svc).audit(actorOf(r), { userId: q?.userId, page: q?.page, pageSize: q?.pageSize })); }

  @Get('catalog') @RequirePermission('roles.view')
  catalog() { return run(async () => svcOrThrow(this.svc).catalog()); }

  /** B-13: end a non-technician staff member's employment (technicians: their profile's Disconnect / End employment). */
  @Post('members/:userId/end-employment') @RequirePermission('roles.manage') @RequireStepUp()
  endEmployment(@Req() r: any, @Param('userId') userId: string, @Body(ValidatedBody(END_EMPLOYMENT_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).endEmployment(actorOf(r), userId, b ?? {})); }

  @Post('ownership/transfer') @RequirePermission('ownership.transfer') @RequireStepUp()
  transfer(@Req() r: any, @Body(ValidatedBody(OWNERSHIP_TRANSFER_BODY, { strict: true })) b: any) { return run(() => svcOrThrow(this.svc).transferOwnership(actorOf(r), b ?? {})); }
}
