/**
 * pos-tech-profile.controller.ts — P3 manager surfaces for the portable tech-profile system.
 * Two controllers (doc-exact prefixes, zero collision with the existing pos/technicians routes):
 *   • /pos/technicians/:technicianId/profile + portfolio moderation + ratings moderation + membership deactivate
 *   • /pos/technician-membership/requests (+ :id/approve | :id/reject)
 * Guard/permission convention mirrors technicians.controller: TenantAuthGuard + RolePermissionGuard with
 * pos.technicians.view (reads) and pos.technicians.edit (moderation/decisions).
 */
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { TechProfileError, TechProfileService, type TechProfileCtx } from './tech-profile.service';
import { POS_TECH_FEATURE_BODY, POS_TECH_PROFILE_BODY, POS_TECH_PROFILE_CHANGE_DECISION_BODY, POS_TECH_PROFILE_POLICY_BODY, POS_TECH_RATING_HIDE_BODY, POS_TECH_PHOTO_HIDE_BODY } from '../request-schemas';
import type { ProfileChangeDecisionResult, ProfileChangeRequestList, TechnicianProfilePolicy } from '@aipowersalon/api-contracts/tenant';   // wire types (§95)

function ctxFrom(req: any): TechProfileCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TechProfileError) {
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      if (e.code === 'not_found' || e.code === 'not_technician') throw new NotFoundException(e.message);
      // §155 standard codes travel in the body so the screen can translate them (§156)
      if (e.code === 'TRANSFER_NOT_ALLOWED' || e.code === 'VERSION_CONFLICT') throw new HttpException({ statusCode: 409, code: e.code, message: e.message }, 409);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('pos/technicians')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class PosTechProfileController {
  constructor(private readonly svc: TechProfileService) {}

  @Get(':technicianId/profile') @RequirePermission('pos.technicians.view')
  profile(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.posViewTechProfile(ctxFrom(r), id)); }

  @Patch(':technicianId/profile') @RequirePermission('pos.technicians.edit')
  updateProfile(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(POS_TECH_PROFILE_BODY, { strict: true })) b: any) { return run(() => this.svc.posUpdateTechProfile(ctxFrom(r), id, b ?? {})); }

  @Patch(':technicianId/feature') @RequirePermission('pos.technicians.edit')
  feature(@Req() r: any, @Param('technicianId') id: string, @Body(ValidatedBody(POS_TECH_FEATURE_BODY, { strict: true })) b: any) { return run(() => this.svc.posSetFeatured(ctxFrom(r), id, b?.featured !== false)); }

  @Patch(':technicianId/portfolio-photos/:photoId/approve') @RequirePermission('pos.technicians.edit')
  approvePhoto(@Req() r: any, @Param('technicianId') id: string, @Param('photoId') photoId: string) {
    return run(() => this.svc.posModeratePhoto(ctxFrom(r), id, photoId, 'approved'));
  }

  @Patch(':technicianId/portfolio-photos/:photoId/hide') @RequirePermission('pos.technicians.edit')
  hidePhoto(@Req() r: any, @Param('technicianId') id: string, @Param('photoId') photoId: string, @Body(ValidatedBody(POS_TECH_PHOTO_HIDE_BODY, { strict: true })) b: { reason?: string | null }) {
    return run(() => this.svc.posModeratePhoto(ctxFrom(r), id, photoId, 'hidden', b?.reason ?? undefined));
  }

  @Get(':technicianId/ratings') @RequirePermission('pos.technicians.view')
  ratings(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.posListRatings(ctxFrom(r), id)); }

  @Patch(':technicianId/ratings/:ratingId/hide') @RequirePermission('pos.technicians.edit')
  hideRating(@Req() r: any, @Param('technicianId') id: string, @Param('ratingId') ratingId: string, @Body(ValidatedBody(POS_TECH_RATING_HIDE_BODY, { strict: true })) b: any) {
    return run(() => this.svc.posSetRatingHidden(ctxFrom(r), id, ratingId, b?.hidden !== false, b?.reason));
  }

  @Post(':technicianId/membership/deactivate') @RequirePermission('pos.technicians.edit')
  deactivate(@Req() r: any, @Param('technicianId') id: string) { return run(() => this.svc.posDeactivateMembership(ctxFrom(r), id)); }
}

@Controller('pos/services')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class PosServiceTechMatchController {
  constructor(private readonly svc: TechProfileService) {}

  @Get(':serviceId/technicians') @RequirePermission('pos.technicians.view')
  match(@Req() r: any, @Param('serviceId') serviceId: string) { return run(() => this.svc.posServiceTechnicians(ctxFrom(r), serviceId)); }
}

@Controller('pos/technician-membership')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class PosTechMembershipController {
  constructor(private readonly svc: TechProfileService) {}

  @Get('requests') @RequirePermission('pos.technicians.view')
  requests(@Req() r: any) { return run(() => this.svc.posListMembershipRequests(ctxFrom(r))); }

  @Post('requests/:requestId/approve') @RequirePermission('pos.technicians.edit')
  approve(@Req() r: any, @Param('requestId') id: string) { return run(() => this.svc.posDecideMembershipRequest(ctxFrom(r), id, 'approve')); }

  @Post('requests/:requestId/reject') @RequirePermission('pos.technicians.edit')
  reject(@Req() r: any, @Param('requestId') id: string) { return run(() => this.svc.posDecideMembershipRequest(ctxFrom(r), id, 'reject')); }
}

/**
 * Technician Profile mandate §95 — publicProfileChangesRequireApproval. The salon's switch, and the queue of held
 * public-profile edits by technicians employed HERE (approve applies the edit; reject sends it back with a note).
 */
@Controller('pos/technician-profile-policy')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class PosTechProfilePolicyController {
  constructor(private readonly svc: TechProfileService) {}

  @Get() @RequirePermission('pos.technicians.view')
  get(@Req() r: any): Promise<TechnicianProfilePolicy> { return run(() => this.svc.posGetProfilePolicy(ctxFrom(r))); }

  @Patch() @RequirePermission('pos.technicians.edit')
  set(@Req() r: any, @Body(ValidatedBody(POS_TECH_PROFILE_POLICY_BODY, { strict: true })) b: any): Promise<TechnicianProfilePolicy> { return run(() => this.svc.posSetProfilePolicy(ctxFrom(r), b?.publicProfileChangesRequireApproval === true)); }
}

@Controller('pos/technician-profile-changes')
@UseGuards(TenantAuthGuard, RolePermissionGuard)
export class PosTechProfileChangesController {
  constructor(private readonly svc: TechProfileService) {}

  @Get() @RequirePermission('pos.technicians.view')
  list(@Req() r: any): Promise<ProfileChangeRequestList> { return run(() => this.svc.posListProfileChanges(ctxFrom(r))); }

  @Post(':requestId/approve') @RequirePermission('pos.technicians.edit')
  approveChange(@Req() r: any, @Param('requestId') id: string, @Body(ValidatedBody(POS_TECH_PROFILE_CHANGE_DECISION_BODY, { strict: true })) b: any): Promise<ProfileChangeDecisionResult> { return run(() => this.svc.posDecideProfileChange(ctxFrom(r), id, 'approved', Number(b?.version), b?.note)); }

  @Post(':requestId/reject') @RequirePermission('pos.technicians.edit')
  rejectChange(@Req() r: any, @Param('requestId') id: string, @Body(ValidatedBody(POS_TECH_PROFILE_CHANGE_DECISION_BODY, { strict: true })) b: any): Promise<ProfileChangeDecisionResult> { return run(() => this.svc.posDecideProfileChange(ctxFrom(r), id, 'rejected', Number(b?.version), b?.note)); }
}
