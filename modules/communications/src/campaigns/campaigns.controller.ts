// campaigns.controller.ts — Campaign Center HTTP surface.
//  • Tenant   /pos/campaigns/*           — TenantAuthGuard + RolePermissionGuard, tenant-scoped CRUD + lifecycle.
//  • Platform /super-admin/campaigns     — SuperAdminGuard, cross-tenant read for S10.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, SuperAdminGuard, RequireFeature, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Patch, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { CampaignsService, ForbiddenError, ValidationError, NotFoundError, CampaignLimitError, CampaignConfirmationRequiredError } from './campaigns.service';
import { PlatformAnnouncementsService } from './platform-announcements.service';
import { CampaignComplianceService } from './campaign-compliance.service';
import { CampaignDeliveryService } from './campaign-delivery.service';
import { CampaignTemplatesService } from './campaign-templates.service';
import type { CampaignsContext } from './campaigns.repository';
import type { CampaignFilters, CampaignChannel, CampaignStatus } from './campaigns.dto';
import { ListQueries } from '@aipowersalon/database';
import { CampaignsControllerListQueries, SuperAdminCampaignsControllerListQueries } from './campaigns.list-queries';
import { CAMPAIGN_ACTIVATE_BODY, CAMPAIGN_CREATE_BODY, CAMPAIGN_UPDATE_BODY, MC_ANNOUNCEMENT_BODY, MC_CANCEL_BODY, MC_LIMITS_BODY, MC_PAUSE_BODY, MC_TEMPLATE_BODY, MC_TEMPLATE_VERSION_BODY } from '../request-schemas';

function ctxFrom(req: any): CampaignsContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): CampaignFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { status: q.status as CampaignStatus, channel: q.channel as CampaignChannel, search: q.search, page: n(q.page), pageSize: n(q.pageSize) }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    // 409, not 400: the request was well-formed, it conflicts with a platform limit right now. The code tells the
    // screen which limit, and the message is already written for the owner.
    if (e instanceof CampaignConfirmationRequiredError) throw new HttpException({ message: e.message, code: e.code, preview: e.preview }, HttpStatus.CONFLICT);   // §81
    if (e instanceof CampaignLimitError) throw new HttpException({ message: e.message, code: e.code }, HttpStatus.CONFLICT);
    if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('marketing')   // BUILD_PLAN Phase 12 (#13): plan-gated — observe by default (feature-entitlement.ts)
@ListQueries(CampaignsControllerListQueries)
@Controller('pos/campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get('state') @RequirePermission('pos.marketing.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  @Get() @RequirePermission('pos.marketing.view') list(@Req() r: any, @Query() q: any) { return run(() => this.svc.list(ctxFrom(r), filtersFrom(q))); }
  @Get(':id') @RequirePermission('pos.marketing.view') detail(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }

  @Post() @RequirePermission('pos.marketing.manage') create(@Req() r: any, @Body(ValidatedBody(CAMPAIGN_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.create(ctxFrom(r), b)); }
  @Patch(':id') @RequirePermission('pos.marketing.manage') update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CAMPAIGN_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.update(ctxFrom(r), id, b)); }
  @Post(':id/schedule') @RequirePermission('pos.marketing.manage') schedule(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.schedule(ctxFrom(r), id)); }
  // wave 3 PAYI §81: activate still needs confirmEstimate for a large SMS campaign (the service builds the same cost preview). The
  // GET :id/cost-preview route was removed with the Campaign Center rebuild — its screen caller moved to
  // POST pos/campaign-center/campaigns/:id/preview (segments + cost of the APPROVED message, never a send).
  @Post(':id/activate') @RequirePermission('pos.marketing.manage') activate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(CAMPAIGN_ACTIVATE_BODY, { strict: true })) b: any) { return run(() => this.svc.activate(ctxFrom(r), id, { confirmEstimate: b?.confirmEstimate === true })); }
  @Post(':id/complete') @RequirePermission('pos.marketing.manage') complete(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.complete(ctxFrom(r), id)); }
  @Post(':id/cancel') @RequirePermission('pos.marketing.manage') cancel(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.cancel(ctxFrom(r), id)); }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminCampaignsControllerListQueries)
@Controller('super-admin/campaigns')
export class SuperAdminCampaignsController {
  constructor(private readonly svc: CampaignsService, private readonly announcements: PlatformAnnouncementsService, private readonly compliance: CampaignComplianceService, private readonly delivery: CampaignDeliveryService, private readonly templates: CampaignTemplatesService) {}

  @Get('state') state(@Query() q: any) { return run(() => this.svc.getPlatformState({ ...filtersFrom(q), tenantId: q.tenantId || undefined })); }
  @Get('marketing-overview') marketingOverview(@Query() q: any) { return run(() => this.svc.getMarketingOverview({ tenantId: q.tenantId || undefined, channel: q.channel || undefined, status: q.status || undefined, ownerType: q.ownerType || undefined, page: +q?.page || 1, pageSize: +q?.pageSize || 10 })); }
  @Get('promotions') promotions(@Query() q: any) { return run(() => this.svc.getPlatformPromotions({ status: q?.status, search: q?.search, page: +q?.page || 1, pageSize: +q?.pageSize || 50, tenantId: q.tenantId || undefined })); }

  @Get('announcements') listAnnouncements(@Query() q: any) { return run(() => this.announcements.list({ status: q?.status || undefined })); }
  @Post('announcements') createAnnouncement(@Body(ValidatedBody(MC_ANNOUNCEMENT_BODY, { strict: true })) b: any, @Req() r: any) { return run(() => this.announcements.create({ title: b?.title, body: b?.body, channel: b?.channel, audienceScope: b?.audienceScope, tenantIds: Array.isArray(b?.tenantIds) ? b.tenantIds : [], scheduledAt: b?.scheduledAt || null, createdByUserId: r?.ctx?.userId || r?.user?.id || null })); }
  @Post('announcements/:id/schedule') scheduleAnnouncement(@Param('id') id: string) { return run(() => this.announcements.schedule(id)); }
  @Post('announcements/:id/send') sendAnnouncement(@Param('id') id: string) { return run(() => this.announcements.send(id)); }
  @Post('announcements/:id/cancel') cancelAnnouncement(@Param('id') id: string, @Body(ValidatedBody(MC_CANCEL_BODY, { strict: true })) b: any) { return run(() => this.announcements.cancel(id, b?.reason || '')); }

  @Get('compliance/alerts') complianceAlerts(@Req() r: any) { return run(() => this.compliance.alertsSummary(ctxFrom(r).tenantId)); }
  @Get('compliance/flags') complianceFlags(@Req() r: any, @Query() q: any) { return run(() => this.compliance.listFlags(ctxFrom(r).tenantId, { status: q?.status || undefined })); }
  @Post('compliance/pause') pauseCampaign(@Body(ValidatedBody(MC_PAUSE_BODY, { strict: true })) b: any, @Req() r: any) { return run(() => this.compliance.pause({ subjectType: b?.subjectType, subjectId: b?.subjectId, subjectName: b?.subjectName, tenantId: b?.tenantId, currentStatus: b?.currentStatus, reason: b?.reason || '', actorUserId: r?.ctx?.userId || r?.user?.id || null })); }
  @Get('compliance/limits') getLimits() { return run(() => this.compliance.getLimits()); }
  @Post('compliance/limits') setLimits(@Body(ValidatedBody(MC_LIMITS_BODY, { strict: true })) b: any, @Req() r: any) { return run(() => this.compliance.setLimits({ maxSendsPerDay: b?.maxSendsPerDay ?? null, maxCampaignsPerDay: b?.maxCampaignsPerDay ?? null, quietHoursStart: b?.quietHoursStart ?? null, quietHoursEnd: b?.quietHoursEnd ?? null, minHoursBetween: b?.minHoursBetween ?? null, updatedByUserId: r?.ctx?.userId || r?.user?.id || null })); }

  @Get('delivery-failures') deliveryFailures(@Req() r: any, @Query() q: any) {
    const { tenantId } = ctxFrom(r);
    return run(async () => ({ summary: await this.delivery.failureSummary(tenantId), items: await this.delivery.listFailures(tenantId, { category: q?.category || undefined }) }));
  }
  @Get('delivery-summary') deliverySummary(@Req() r: any) { return run(() => this.delivery.deliveryKpis(ctxFrom(r).tenantId)); }
  @Get('performance-trend') performanceTrend(@Query() q: any) { return run(() => this.delivery.performanceTrend(+q?.days || 7)); }

  @Get('templates') listTemplates(@Query() q: any) { return run(() => this.templates.list({ status: q?.status || undefined })); }
  @Get('templates/:id/versions') templateVersions(@Param('id') id: string) { return run(() => this.templates.versions(id)); }
  @Post('templates') createTemplate(@Body(ValidatedBody(MC_TEMPLATE_BODY, { strict: true })) b: any, @Req() r: any) { return run(() => this.templates.create({ name: b?.name, campaignType: b?.campaignType, channel: b?.channel, subject: b?.subject, body: b?.body, smsContent: b?.smsContent, pushTitle: b?.pushTitle, pushContent: b?.pushContent, suggestedAudience: b?.suggestedAudience, suggestedOffer: b?.suggestedOffer, complianceNote: b?.complianceNote, createdByUserId: r?.ctx?.userId || r?.user?.id || null })); }
  @Post('templates/:id/versions') addTemplateVersion(@Param('id') id: string, @Body(ValidatedBody(MC_TEMPLATE_VERSION_BODY, { strict: true })) b: any, @Req() r: any) { return run(() => this.templates.newVersion(id, { subject: b?.subject, body: b?.body, channel: b?.channel, notes: b?.notes, createdByUserId: r?.ctx?.userId || r?.user?.id || null })); }
  @Post('templates/:id/publish') publishTemplate(@Param('id') id: string) { return run(() => this.templates.publish(id)); }

  @Get() list(@Query() q: any) { return run(() => this.svc.listPlatform({ ...filtersFrom(q), tenantId: q.tenantId || undefined })); }
}
