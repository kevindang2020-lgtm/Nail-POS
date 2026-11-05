// platform-notice.controller.ts — Platform Announcements on the POS top bar (Oct 22 2026). Thin: guard, validate, call.
//  • Platform /super-admin/communications/platform-announcements — SuperAdminGuard (PLATFORM realm) + the communications
//    keys; publish / pause / resume / archive need a fresh step-up (§137). A salon owner or manager has no route here.
//  • Tenant   /pos/platform-announcements — the EMPLOYEE realm; the tenant and branch come from the session (§87–§88).
import { SuperAdminGuard, TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Body, Controller, Get, HttpException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ListQuery, safeInet } from '@aipowersalon/database';
import type {
  PlatformAnnouncementList, PlatformAnnouncementDetail, PlatformAnnouncementWriteRequest, PlatformAnnouncementPublishRequest, PlatformAnnouncementActionRequest,
  PlatformAnnouncementTenantPage, PlatformAnnouncementBranchOption,
} from '@aipowersalon/api-contracts/platform';
import type { PosPlatformAnnouncementSnapshot, PosPlatformAnnouncementReceiptRequest, PosPlatformAnnouncementReceiptResult } from '@aipowersalon/api-contracts/tenant';
import { PlatformNoticeService, PlatformNoticeError, type PlatformActor, type PosActor } from './platform-notice.service';
import { PLATFORM_NOTICE_WRITE_BODY, PLATFORM_NOTICE_PATCH_BODY, PLATFORM_NOTICE_PUBLISH_BODY, PLATFORM_NOTICE_ACTION_BODY, POS_NOTICE_RECEIPT_BODY } from '../request-schemas';

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof PlatformNoticeError) throw new HttpException({ code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }, e.status);
    throw e;
  }
}
const platformCtx = (r: any): PlatformActor => { const c = r?.ctx || {}; return { userId: c.userId, permissions: c.permissions || [], role: c.role ?? null, ip: safeInet(r?.ip) ?? null }; };
const posCtx = (r: any): PosActor => { const c = r?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, permissions: c.permissions || [], role: c.role ?? null }; };

@UseGuards(SuperAdminGuard)
@Controller('super-admin/communications/platform-announcements')
export class SuperAdminPlatformNoticeController {
  constructor(private readonly svc: PlatformNoticeService) {}
  // the service pages, searches (title / message / target salon) and orders (newest change first) itself — the spec declares
  // and bounds what it reads (Constitution 5 §47–§52)
  @ListQuery({ filters: { status: { type: 'enum', values: ['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'] } }, search: { maxLength: 200 }, maxLimit: 100, defaultLimit: 25, params: ['page'] })
  @Get() @RequirePermission('super_admin.communications.view') announcementList(@Req() r: any, @Query() q: any): Promise<PlatformAnnouncementList> {
    return run(() => this.svc.list(platformCtx(r), { status: q?.status || null, q: q?.q || null, page: Number(q?.page) || null, pageSize: Number(q?.pageSize) || null }));
  }
  @ListQuery({ search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] })
  @Get('audience/tenants') @RequirePermission('super_admin.communications.view') audienceTenants(@Req() r: any, @Query() q: any): Promise<PlatformAnnouncementTenantPage> {
    return run(() => this.svc.tenantOptions(platformCtx(r), { q: q?.q || null, page: Number(q?.page) || null, pageSize: Number(q?.pageSize) || null }));
  }
  @Get('audience/tenants/:tenantId/branches') @RequirePermission('super_admin.communications.view') audienceBranches(@Req() r: any, @Param('tenantId') tenantId: string): Promise<PlatformAnnouncementBranchOption[]> {
    return run(() => this.svc.branchOptions(platformCtx(r), tenantId));
  }
  @Get(':id') @RequirePermission('super_admin.communications.view') announcement(@Req() r: any, @Param('id') id: string): Promise<PlatformAnnouncementDetail> { return run(() => this.svc.get(platformCtx(r), id)); }
  @Post() @RequirePermission('super_admin.communications.manage') createAnnouncement(@Req() r: any, @Body(ValidatedBody(PLATFORM_NOTICE_WRITE_BODY, { strict: true })) b: PlatformAnnouncementWriteRequest): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.create(platformCtx(r), b));
  }
  @Patch(':id') @RequirePermission('super_admin.communications.manage') updateAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PLATFORM_NOTICE_PATCH_BODY, { strict: true })) b: PlatformAnnouncementWriteRequest): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.update(platformCtx(r), id, b));
  }
  @RequireStepUp() @Post(':id/publish') @RequirePermission('super_admin.communications.manage') publishAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PLATFORM_NOTICE_PUBLISH_BODY, { strict: true })) b: PlatformAnnouncementPublishRequest): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.publish(platformCtx(r), id, b ?? {}));
  }
  @RequireStepUp() @Post(':id/pause') @RequirePermission('super_admin.communications.manage') pauseAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PLATFORM_NOTICE_ACTION_BODY, { strict: true })) b: PlatformAnnouncementActionRequest): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.pause(platformCtx(r), id, b ?? {}));
  }
  @RequireStepUp() @Post(':id/resume') @RequirePermission('super_admin.communications.manage') resumeAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PLATFORM_NOTICE_ACTION_BODY, { strict: true })) b: PlatformAnnouncementActionRequest): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.resume(platformCtx(r), id, b ?? {}));
  }
  @RequireStepUp() @Post(':id/archive') @RequirePermission('super_admin.communications.manage') archiveAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PLATFORM_NOTICE_ACTION_BODY, { strict: true })) b: PlatformAnnouncementActionRequest): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.archive(platformCtx(r), id, b ?? {}));
  }
  @Post(':id/duplicate') @RequirePermission('super_admin.communications.manage') duplicateAnnouncement(@Req() r: any, @Param('id') id: string): Promise<PlatformAnnouncementDetail> {
    return run(() => this.svc.duplicate(platformCtx(r), id));
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/platform-announcements')
export class PosPlatformNoticeController {
  constructor(private readonly svc: PlatformNoticeService) {}
  /** The startup / reconnect / safety-sync snapshot (every signed-in POS employee). */
  @Get('active') @RequirePermission('pos.login') activeAnnouncements(@Req() r: any): Promise<PosPlatformAnnouncementSnapshot> { return run(() => this.svc.active(posCtx(r))); }
  @Post(':id/dismiss') @RequirePermission('pos.login') dismissAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(POS_NOTICE_RECEIPT_BODY, { strict: true })) b: PosPlatformAnnouncementReceiptRequest): Promise<PosPlatformAnnouncementReceiptResult> {
    return run(() => this.svc.receipt(posCtx(r), id, 'dismissed', b.contentVersion));
  }
  @Post(':id/acknowledge') @RequirePermission('pos.login') acknowledgeAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(POS_NOTICE_RECEIPT_BODY, { strict: true })) b: PosPlatformAnnouncementReceiptRequest): Promise<PosPlatformAnnouncementReceiptResult> {
    return run(() => this.svc.receipt(posCtx(r), id, 'acknowledged', b.contentVersion));
  }
  @Post(':id/delivered') @RequirePermission('pos.login') deliveredAnnouncement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(POS_NOTICE_RECEIPT_BODY, { strict: true })) b: PosPlatformAnnouncementReceiptRequest): Promise<PosPlatformAnnouncementReceiptResult> {
    return run(() => this.svc.receipt(posCtx(r), id, 'delivered', b.contentVersion));
  }
}
