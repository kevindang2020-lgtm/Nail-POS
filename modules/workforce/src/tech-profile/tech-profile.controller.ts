import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
/**
 * tech-profile.controller.ts — Technician-app HTTP surface for the portable profile (/tech/profile*).
 * Mirrors tech.controller exactly: ctx from session, thin routes, TechProfileError → HTTP mapping.
 */
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException, NotFoundException, Param, Patch, Post, Req, ServiceUnavailableException, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { PendingProfileChangeWithdrawResult, PortfolioShowcaseShareResult, PortfolioShowcaseUnshareResult } from '@aipowersalon/api-contracts/tenant';   // wire types (§46/§95)
import { UPLOAD_POLICIES } from '@aipowersalon/media';   // Phase 12 (#34): the interceptor limits are the upload policy's
import { TechProfileError, TechProfileService, type TechProfileCtx } from './tech-profile.service';
import { DM_REPORT_BODY, DM_SEND_BODY, TECH_BEFORE_AFTER_FORM_BODY, TECH_BEFORE_AFTER_UPDATE_BODY, TECH_MEMBERSHIP_REQUEST_BODY, TECH_PHOTOS_FORM_BODY, TECH_PHOTO_CONSENT_BODY, TECH_PHOTO_REORDER_BODY, TECH_PHOTO_UPDATE_BODY, TECH_PROFILE_UPDATE_BODY, TECH_REVIEW_RESPOND_BODY } from '../request-schemas';

function ctxFrom(req: any): TechProfileCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TechProfileError) {
      if (e.code === 'forbidden' || e.code === 'not_technician') throw new ForbiddenException(e.message);
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'unavailable') throw new ServiceUnavailableException(e.message);
      if (e.code === 'VERSION_CONFLICT' || e.code === 'TRANSFER_NOT_ALLOWED') throw new HttpException({ statusCode: 409, code: e.code, message: e.message }, 409);
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}

@Controller('tech/profile')
export class TechProfileController {
  constructor(private readonly svc: TechProfileService) {}

  @RequirePermission('tech.dashboard.view') @Get() me(@Req() r: any) { return run(() => this.svc.getOrCreateMyProfile(ctxFrom(r))); }
  @RequirePermission('tech.profile.edit') @Patch() update(@Req() r: any, @Body(ValidatedBody(TECH_PROFILE_UPDATE_BODY)) b: any) { return run(() => this.svc.updateMyProfile(ctxFrom(r), b ?? {})); }
  @RequirePermission('tech.profile.edit') @Post('membership-request') request(@Req() r: any, @Body(ValidatedBody(TECH_MEMBERSHIP_REQUEST_BODY)) b: any) { return run(() => this.svc.requestMembership(ctxFrom(r), String(b?.salonCode ?? ''), b?.message, { transfer: b?.transfer === true })); }
  /** §95: take back a held public-profile edit. */
  /** §46 portfolio → Nail Showcase (share / take back). */
  @RequirePermission('tech.profile.edit') @Post('photos/:photoId/showcase') share(@Req() r: any, @Param('photoId') id: string): Promise<PortfolioShowcaseShareResult> { return run(() => this.svc.sharePhotoToShowcase(ctxFrom(r), id)); }
  @RequirePermission('tech.profile.edit') @Delete('photos/:photoId/showcase') unshare(@Req() r: any, @Param('photoId') id: string): Promise<PortfolioShowcaseUnshareResult> { return run(() => this.svc.unsharePhotoFromShowcase(ctxFrom(r), id)); }
  @RequirePermission('tech.profile.edit') @Post('pending-changes/withdraw') withdrawPending(@Req() r: any): Promise<PendingProfileChangeWithdrawResult> { return run(() => this.svc.withdrawMyPendingChange(ctxFrom(r))); }
  @RequirePermission('tech.profile.edit') @Post('membership-request/:requestId/cancel')
  cancel(@Req() r: any, @Param('requestId') id: string) { return run(() => this.svc.cancelMyMembershipRequest(ctxFrom(r), id)); }

  @RequirePermission('tech.dashboard.view') @Get('membership-status') status(@Req() r: any) { return run(async () => ({ memberships: (await this.svc.getOrCreateMyProfile(ctxFrom(r))).memberships })); }
  @RequirePermission('tech.dashboard.view') @Get('ratings') ratings(@Req() r: any) { return run(() => this.svc.myRatings(ctxFrom(r))); }
  @RequirePermission('tech.profile.edit') @Post('ratings/:reviewId/respond') respond(@Req() r: any, @Param('reviewId') id: string, @Body(ValidatedBody(TECH_REVIEW_RESPOND_BODY)) b: any) { return run(() => this.svc.respondToReview(ctxFrom(r), id, String(b?.response ?? ''))); }
  @RequirePermission('tech.dashboard.view') @Get('messages') dmThreads(@Req() r: any) { return run(() => this.svc.technicianListThreads(ctxFrom(r))); }
  @RequirePermission('tech.dashboard.view') @Get('messages/:threadId') dmMessages(@Req() r: any, @Param('threadId') id: string) { return run(() => this.svc.technicianListMessages(ctxFrom(r), id)); }
  @RequirePermission('tech.profile.edit') @Post('messages/:threadId') dmSend(@Req() r: any, @Param('threadId') id: string, @Body(ValidatedBody(DM_SEND_BODY)) b: any) { return run(() => this.svc.technicianSendMessage(ctxFrom(r), id, String(b?.body ?? ''))); }
  @RequirePermission('tech.profile.edit') @Post('messages/:threadId/block') dmBlock(@Req() r: any, @Param('threadId') id: string) { return run(() => this.svc.blockThread(ctxFrom(r), id, 'technician')); }
  @RequirePermission('tech.profile.edit') @Post('messages/:threadId/report') dmReport(@Req() r: any, @Param('threadId') id: string, @Body(ValidatedBody(DM_REPORT_BODY)) b: any) { return run(() => this.svc.reportThread(ctxFrom(r), id, 'technician', b?.reason)); }
  @RequirePermission('tech.dashboard.view') @Get('public-preview') preview(@Req() r: any) { return run(() => this.svc.myPublicPreview(ctxFrom(r))); }
  @RequirePermission('tech.dashboard.view') @Get('analytics') analytics(@Req() r: any) { return run(() => this.svc.technicianAnalytics(ctxFrom(r), 30)); }
  @RequirePermission('tech.profile.edit') @Post('verification/request') requestVerification(@Req() r: any) { return run(() => this.svc.requestVerification(ctxFrom(r))); }

  @RequirePermission('tech.profile.edit') @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.avatar.maxBytes + 1024 } }))
  avatar(@Req() r: any, @UploadedFile() file: any) {
    return run(() => this.svc.uploadAvatar(ctxFrom(r), file?.buffer ?? Buffer.alloc(0)));
  }

  @RequirePermission('tech.profile.edit') @Post('cover')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.profilePhoto.maxBytes + 1024 } }))
  cover(@Req() r: any, @UploadedFile() file: any) {
    return run(() => this.svc.uploadCover(ctxFrom(r), file?.buffer ?? Buffer.alloc(0)));
  }
  @RequirePermission('tech.profile.edit') @Delete('cover') removeCover(@Req() r: any) { return run(() => this.svc.removeCover(ctxFrom(r))); }

  @RequirePermission('tech.dashboard.view') @Get('photos') photos(@Req() r: any) { return run(() => this.svc.listMyPhotos(ctxFrom(r))); }

  @RequirePermission('tech.profile.edit') @Post('photos')
  @UseInterceptors(FilesInterceptor('files', 10, { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.profilePhoto.maxBytes + 1024 } }))
  addPhotos(@Req() r: any, @UploadedFiles() files: any[], @Body(ValidatedBody(TECH_PHOTOS_FORM_BODY)) b: any) {
    return run(() => this.svc.addPortfolioPhotos(ctxFrom(r), (files ?? []).map((f) => f.buffer), b?.caption));
  }

  @RequirePermission('tech.profile.edit') @Patch('photos/reorder') reorder(@Req() r: any, @Body(ValidatedBody(TECH_PHOTO_REORDER_BODY)) b: any) { return run(() => this.svc.reorderPhotos(ctxFrom(r), Array.isArray(b?.photoIds) ? b.photoIds.map(String) : [])); }
  @RequirePermission('tech.profile.edit') @Patch('photos/:photoId') updatePhoto(@Req() r: any, @Param('photoId') id: string, @Body(ValidatedBody(TECH_PHOTO_UPDATE_BODY)) b: any) { return run(() => this.svc.updatePhoto(ctxFrom(r), id, b ?? {})); }
  @RequirePermission('tech.profile.edit') @Delete('photos/:photoId') deletePhoto(@Req() r: any, @Param('photoId') id: string) { return run(() => this.svc.deletePhoto(ctxFrom(r), id)); }
  @RequirePermission('tech.profile.edit') @Post('photos/:photoId/consent') setConsent(@Req() r: any, @Param('photoId') id: string, @Body(ValidatedBody(TECH_PHOTO_CONSENT_BODY)) b: any) { return run(() => this.svc.setPhotoConsent(ctxFrom(r), id, b ?? {})); }
  @RequirePermission('tech.profile.edit') @Post('photos/:photoId/consent/withdraw') withdrawConsent(@Req() r: any, @Param('photoId') id: string) { return run(() => this.svc.withdrawPhotoConsent(ctxFrom(r), id)); }

  @RequirePermission('tech.dashboard.view') @Get('before-after') listBeforeAfter(@Req() r: any) { return run(() => this.svc.listMyBeforeAfter(ctxFrom(r))); }
  @RequirePermission('tech.profile.edit') @Post('before-after')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'before', maxCount: 1 }, { name: 'after', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: UPLOAD_POLICIES.profilePhoto.maxBytes + 1024 } }))
  createBeforeAfter(@Req() r: any, @UploadedFiles() files: { before?: any[]; after?: any[] }, @Body(ValidatedBody(TECH_BEFORE_AFTER_FORM_BODY)) b: any) {
    return run(() => this.svc.createBeforeAfter(ctxFrom(r), files?.before?.[0]?.buffer ?? Buffer.alloc(0), files?.after?.[0]?.buffer ?? Buffer.alloc(0), b ?? {}));
  }
  @RequirePermission('tech.profile.edit') @Patch('before-after/:setId') updateBeforeAfter(@Req() r: any, @Param('setId') id: string, @Body(ValidatedBody(TECH_BEFORE_AFTER_UPDATE_BODY)) b: any) { return run(() => this.svc.updateBeforeAfter(ctxFrom(r), id, b ?? {})); }
  @RequirePermission('tech.profile.edit') @Delete('before-after/:setId') deleteBeforeAfter(@Req() r: any, @Param('setId') id: string) { return run(() => this.svc.deleteBeforeAfter(ctxFrom(r), id)); }
}
