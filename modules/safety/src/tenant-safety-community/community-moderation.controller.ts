// community-moderation.controller.ts — BUILD_PLAN Phase 8 (agent B): the Super Admin "Safety Community Moderation" API.
// SuperAdminGuard; the derived platform key for 'community-moderation' (workforce: super_admin.technicians.view for reads,
// .manage for writes — PlatformDomainGuard). The moderator is req.ctx.userId (bug 2 — never req.user). Every WRITE needs a
// recent step-up (Constitution 7 §8) and a reason, and runs under a real moderation case (the service). Opening raw
// evidence is a read but crosses a salon's privacy boundary, so it needs step-up too. Errors: { ok:false, code, ... }.
import { SuperAdminGuard, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { MOD_APPEAL_DECISION_BODY, MOD_CASE_UPDATE_BODY, MOD_COMMENT_ACTION_BODY, MOD_DISPUTE_DECISION_BODY, MOD_EVIDENCE_REVIEW_BODY, MOD_INCIDENT_ACCESS_BODY, MOD_OPEN_CASE_BODY, MOD_POST_ACTION_BODY, MOD_REPORT_RESOLVE_BODY, MOD_SETTINGS_BODY, MOD_TENANT_ACTION_BODY } from '../request-schemas';
import { Body, Controller, Get, HttpException, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { CommunityModerationService, type ModActor } from './community-moderation.service';
import { ListQueries } from '@aipowersalon/database';
import { CommunityModerationControllerListQueries } from './community-moderation.list-queries';

function actor(req: any): ModActor { return { userId: req?.ctx?.userId ?? '' }; }
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    // CommunityModerationError, and the core's / interactions' CommunityError (same shape) from a port
    if (e && !(e instanceof HttpException) && typeof e.code === 'string' && typeof e.status === 'number') throw new HttpException({ ok: false, code: e.code, ...(e.extra || {}) }, e.status);
    throw e;
  }
}

@UseGuards(SuperAdminGuard)
@ListQueries(CommunityModerationControllerListQueries)
@Controller('super-admin/community-moderation')
export class CommunityModerationController {
  constructor(@Inject(CommunityModerationService) private readonly svc: CommunityModerationService) {}

  @Get('overview')
  overview(@Req() r: any) { return run(() => this.svc.overview(actor(r))); }

  // ── posts ──
  @Get('posts')
  posts(@Query() q: any) { return run(() => this.svc.listPosts(q)); }
  @Get('posts/:id')
  post(@Param('id') id: string) { return run(() => this.svc.postDetail(id)); }
  @Get('posts/:id/comments')
  postComments(@Param('id') id: string) { return run(() => this.svc.postComments(id)); }
  @RequireStepUp()
  @Post('posts/:id/actions')
  postAction(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_POST_ACTION_BODY)) b: any) { return run(() => this.svc.postAction(actor(r), id, b)); }

  // ── comments ──
  @RequireStepUp()
  @Post('comments/:id/actions')
  commentAction(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_COMMENT_ACTION_BODY)) b: any) { return run(() => this.svc.commentAction(actor(r), id, b)); }

  // ── cases ──
  @Get('cases')
  cases(@Req() r: any, @Query() q: any) { return run(() => this.svc.listCases(actor(r), q)); }
  @RequireStepUp()
  @Post('cases')
  openCase(@Req() r: any, @Body(ValidatedBody(MOD_OPEN_CASE_BODY)) b: any) { return run(() => this.svc.openCase(actor(r), b)); }
  @Get('cases/:id')
  caseDetail(@Param('id') id: string) { return run(() => this.svc.caseDetail(id)); }
  @RequireStepUp()
  @Patch('cases/:id')
  updateCase(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_CASE_UPDATE_BODY)) b: any) { return run(() => this.svc.updateCase(actor(r), id, b)); }

  // ── reports / disputes / appeals ──
  @Get('reports')
  reports(@Query() q: any) { return run(() => this.svc.listReports(q)); }
  @RequireStepUp()
  @Post('reports/:id/resolve')
  resolveReport(@Req() r: any, @Param('id') id: string, @Query('kind') kind: string, @Body(ValidatedBody(MOD_REPORT_RESOLVE_BODY)) b: any) { return run(() => this.svc.resolveReport(actor(r), id, kind, b)); }
  @Get('disputes')
  disputes(@Query() q: any) { return run(() => this.svc.listDisputes(q)); }
  @RequireStepUp()
  @Post('disputes/:id/decide')
  decideDispute(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_DISPUTE_DECISION_BODY)) b: any) { return run(() => this.svc.decideDispute(actor(r), id, b)); }
  @Get('appeals')
  appeals(@Req() r: any, @Query() q: any) { return run(() => this.svc.listAppeals(actor(r), q)); }
  @RequireStepUp()
  @Post('appeals/:id/decide')
  decideAppeal(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_APPEAL_DECISION_BODY)) b: any) { return run(() => this.svc.decideAppeal(actor(r), id, b)); }

  // ── evidence + private incidents ──
  @Get('evidence')
  evidence(@Query() q: any) { return run(() => this.svc.listEvidence(q)); }
  @RequireStepUp()
  @Get('evidence/:id/access')
  evidenceAccess(@Req() r: any, @Param('id') id: string, @Query() q: any) { return run(() => this.svc.evidenceAccess(actor(r), id, q)); }
  @RequireStepUp()
  @Post('evidence/:id/review')
  evidenceReview(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_EVIDENCE_REVIEW_BODY)) b: any) { return run(() => this.svc.evidenceReview(actor(r), id, b)); }
  @RequireStepUp()
  @Post('incidents/:id/access')
  incidentAccess(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(MOD_INCIDENT_ACCESS_BODY)) b: any) { return run(() => this.svc.incidentAccess(actor(r), id, b)); }

  // ── salons + restrictions ──
  @Get('tenants')
  tenants(@Query() q: any) { return run(() => this.svc.listTenants(q)); }
  @Get('tenants/:tenantId')
  tenant(@Param('tenantId') tenantId: string) { return run(() => this.svc.tenant(tenantId)); }
  @RequireStepUp()
  @Post('tenants/:tenantId/actions')
  tenantAction(@Req() r: any, @Param('tenantId') tenantId: string, @Body(ValidatedBody(MOD_TENANT_ACTION_BODY)) b: any) { return run(() => this.svc.tenantAction(actor(r), tenantId, b)); }
  @Get('restrictions')
  restrictions(@Query() q: any) { return run(() => this.svc.listRestrictions(q)); }

  // ── trail, analytics, settings ──
  @Get('actions')
  actions(@Query() q: any) { return run(() => this.svc.listActions(q)); }
  @Get('analytics')
  analytics(@Query() q: any) { return run(() => this.svc.analytics(q)); }
  @Get('settings')
  settings() { return run(() => this.svc.settings()); }
  @RequireStepUp()
  @Put('settings')
  updateSettings(@Req() r: any, @Body(ValidatedBody(MOD_SETTINGS_BODY)) b: any) { return run(() => this.svc.updateSettings(actor(r), b)); }
}
