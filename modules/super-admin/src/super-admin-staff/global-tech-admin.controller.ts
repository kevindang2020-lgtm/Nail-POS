// global-tech-admin.controller.ts — /super-admin/technicians/*. SuperAdminGuard only.
//
// The write routes here are the ONLY ones on the platform that can touch a technician's global account. A salon
// has no route into this file: `check:public` and the guard see to the first half of that, and the fact that
// nothing in `pos/` or `tech/` imports GlobalTechAdminService sees to the other half.
import { SuperAdminGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req,
  ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { safeInet, ListQueries } from '@aipowersalon/database';
import { GlobalTechAdminError, GlobalTechAdminService, type AdminCtx } from './global-tech-admin.service';
import { GlobalTechAdminControllerListQueries } from './global-tech-admin.list-queries';
import { TECH_DELETE_DECISION_BODY, TECH_DELETE_REQUEST_BODY, TECH_MERGE_BODY, TECH_PAUSE_BODY, TECH_REASON_BODY, TECH_SCOPED_PAUSE_BODY } from '../request-schemas-workforce';   // BUILD_PLAN Phase 12 (#17)
import { TECH_MEMBERSHIP_BODY } from '../request-schemas-leads';   // BUILD_PLAN Phase 12 (#17)

function ctxFrom(req: any): AdminCtx {
  return { userId: req?.ctx?.userId, ip: safeInet(req?.ip) ?? undefined };
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof GlobalTechAdminError) {
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'unavailable') throw new ServiceUnavailableException(e.message);
      if (e.code === 'elevation_required') throw new ForbiddenException({ code: e.code, message: e.message });
      // A refused merge or a blocked erasure is not a malformed request — it is a correct answer the operator
      // has to read. 409 says "your request was understood and the system is telling you no."
      if (e.code === 'shared_salon' || e.code === 'legal_hold' || e.code === 'not_approved' || e.code === 'no_request' || e.code === 'already_anonymized') {
        throw new ConflictException({ code: e.code, message: e.message });
      }
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@UseGuards(SuperAdminGuard, RolePermissionGuard)
@ListQueries(GlobalTechAdminControllerListQueries)
@Controller('super-admin/technicians')
export class GlobalTechAdminController {
  constructor(private readonly svc: GlobalTechAdminService) {}

  // literals before the bare :profileId, or 'duplicates' resolves as a profile id
  @RequirePermission('super_admin.technicians.view')
  @Get('duplicates')
  duplicates() { return run(() => this.svc.duplicates()); }

  @RequirePermission('super_admin.technicians.view')
  @Get('my-elevation')
  myElevation(@Req() r: any) { return run(() => this.svc.myElevation(ctxFrom(r))); }

  @RequirePermission('super_admin.technicians.view')
  @Get('')
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return run(() => this.svc.search(q ?? '', limit ? Number(limit) : 50));
  }

  @RequirePermission('super_admin.technicians.view')
  @Get(':profileId')
  detail(@Param('profileId') id: string) { return run(() => this.svc.detail(id)); }

  @RequirePermission('super_admin.technicians.view')
  @Get(':profileId/work-history')
  async workHistory(@Param('profileId') id: string) {
    const d = await run(() => this.svc.detail(id));
    return { techCode: d.profile.techCode, salons: d.salons };
  }

  @RequirePermission('super_admin.technicians.suspend')
  @Post(':profileId/suspend')
  suspend(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_REASON_BODY)) b: any) {
    return run(() => this.svc.suspend(ctxFrom(r), id, String(b?.reason ?? '')));
  }

  @RequirePermission('super_admin.technicians.restore')
  @Post(':profileId/restore')
  restore(@Req() r: any, @Param('profileId') id: string) { return run(() => this.svc.restore(ctxFrom(r), id)); }

  @RequirePermission('super_admin.technicians.pause')
  @Post(':profileId/pause')
  pause(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_PAUSE_BODY)) b: any) {
    return run(() => this.svc.pauseAccount(ctxFrom(r), id, String(b?.reason ?? ''), { expiresAt: b?.expiresAt ?? null }));
  }

  @RequirePermission('super_admin.technicians.reactivate')
  @Post(':profileId/reactivate')
  reactivate(@Req() r: any, @Param('profileId') id: string) { return run(() => this.svc.reactivateAccount(ctxFrom(r), id)); }

  @RequirePermission('super_admin.technicians.security_manage')
  @Post(':profileId/lock')
  lock(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_REASON_BODY)) b: any) { return run(() => this.svc.lockAccount(ctxFrom(r), id, String(b?.reason ?? ''))); }

  @RequirePermission('super_admin.technicians.security_manage')
  @Post(':profileId/unlock')
  unlock(@Req() r: any, @Param('profileId') id: string) { return run(() => this.svc.unlockAccount(ctxFrom(r), id)); }

  @RequirePermission('super_admin.technicians.view')
  @Get(':profileId/status-history')
  statusHistory(@Param('profileId') id: string) { return run(() => this.svc.statusHistory(id)); }

  @RequirePermission('super_admin.technicians.profile_moderate')
  @Post(':profileId/scoped-pause')
  scopedPause(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_SCOPED_PAUSE_BODY)) b: any) {
    return run(() => this.svc.setScopedPause(ctxFrom(r), id, b?.scope, !!b?.paused, b?.reason));
  }

  @RequirePermission('super_admin.technicians.view')
  @Get(':profileId/support')
  support(@Req() r: any, @Param('profileId') id: string) { return run(() => this.svc.techSupportSummary(ctxFrom(r), id)); }

  @RequirePermission('super_admin.technicians.security_manage')
  @Post(':profileId/revoke-sessions')
  revokeSessions(@Req() r: any, @Param('profileId') id: string) { return run(() => this.svc.revokeSessions(ctxFrom(r), id)); }

  @RequirePermission('super_admin.technicians.delete_request')
  @Post(':profileId/delete-request')
  requestDeletion(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_DELETE_REQUEST_BODY)) b: any) {
    return run(() => this.svc.requestDeletion(ctxFrom(r), id, b ?? {}));
  }

  @RequirePermission('super_admin.technicians.delete_request')
  @Post('delete-requests/:requestId/decision')
  decideDeletion(@Req() r: any, @Param('requestId') id: string, @Body(ValidatedBody(TECH_DELETE_DECISION_BODY)) b: any) {
    return run(() => this.svc.decideDeletion(ctxFrom(r), id, b?.decision, b?.note));
  }

  /** The act. It will refuse unless a request exists, is approved, carries a reason, and has no legal hold. */
  @RequirePermission('super_admin.technicians.anonymize')
  @Post(':profileId/anonymize')
  anonymize(@Req() r: any, @Param('profileId') id: string) { return run(() => this.svc.anonymize(ctxFrom(r), id)); }

  /** Absorb `duplicateId` into this profile. Refuses if they share a salon — see decideMerge. */
  @RequirePermission('super_admin.technicians.merge')
  @Post(':profileId/merge')
  merge(@Req() r: any, @Param('profileId') id: string, @Body(ValidatedBody(TECH_MERGE_BODY)) b: any) {
    return run(() => this.svc.merge(ctxFrom(r), id, String(b?.duplicateId ?? ''), String(b?.reason ?? '')));
  }
}

/**
 * /super-admin/technician-memberships/:membershipId — pause or reactivate ONE salon membership. Separate base path so it
 * reads as an act on a membership, not on the technician. SuperAdminGuard only; a salon can never reach this.
 */
@UseGuards(SuperAdminGuard, RolePermissionGuard)
@Controller('super-admin/technician-memberships')
export class TechMembershipAdminController {
  constructor(private readonly svc: GlobalTechAdminService) {}

  @RequirePermission('super_admin.technicians.memberships_manage')
  @Patch(':membershipId')
  update(@Req() r: any, @Param('membershipId') id: string, @Body(ValidatedBody(TECH_MEMBERSHIP_BODY)) b: any) {
    const action = String(b?.action ?? '');
    if (action === 'pause') return run(() => this.svc.pauseMembership(ctxFrom(r), id, String(b?.reason ?? '')));
    if (action === 'reactivate') return run(() => this.svc.reactivateMembership(ctxFrom(r), id));
    if (action === 'approve_destination') return run(() => this.svc.decideDestinationApproval(ctxFrom(r), id, true, b?.reason));
    if (action === 'reject_destination') return run(() => this.svc.decideDestinationApproval(ctxFrom(r), id, false, b?.reason));
    throw new BadRequestException("action must be 'pause', 'reactivate', 'approve_destination', or 'reject_destination'");
  }
}
