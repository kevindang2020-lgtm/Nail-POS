// community.controller.ts — the tenant-facing Safety Community core API (BUILD_PLAN Phase 8, agent A). TenantAuthGuard +
// RolePermissionGuard; tenant, branch, user and role come from req.ctx (server-derived, never the client) — an empty
// branch is null (bug 8). Each handler names its community.* permission; the service enforces the deeper role /
// visibility / restriction rules through the Phase-1 core and validates every body / query (400 invalid_input naming the
// field). CommunityError → { ok:false, code, ... } with its HTTP status. Comments / follows / similar / evidence / alerts
// live in community-interactions.controller.ts (agent C); moderation in community-moderation.controller.ts (agent B).
import { branchOrNull } from '@aipowersalon/tenant-context';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody, AsyncExport } from '@aipowersalon/permissions/guards';
import { COMMUNITY_ADVISORY_CREATE_BODY, COMMUNITY_ADVISORY_UPDATE_BODY, COMMUNITY_APPEAL_BODY, COMMUNITY_ASSIST_BODY, COMMUNITY_DISPUTE_BODY, COMMUNITY_INCIDENT_BODY, COMMUNITY_POST_UPDATE_BODY, COMMUNITY_REPORT_BODY, COMMUNITY_RULES_ACK_BODY, COMMUNITY_SETTINGS_BODY, COMMUNITY_SUBMIT_BODY, COMMUNITY_VERSIONED_BODY, COMMUNITY_VERSIONED_NOTE_BODY } from '../request-schemas';
import { Body, Controller, Get, Header, HttpCode, HttpException, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { CommunityService, CommunityError } from './community.service';
import type { CommunityCtx } from './community.repository';
import { ListQueries } from '@aipowersalon/database';
import type { CommunityRolePreview, CommunityCorrectionsInbox } from '@aipowersalon/api-contracts/tenant';
import type { ListQuery } from '@aipowersalon/api-contracts';
import { CommunityControllerListQueries } from './community.list-queries';

export function tctx(req: any): CommunityCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: branchOrNull(c.branchId) || null, userId: c.userId, role: c.role, permissions: Array.isArray(c.permissions) ? c.permissions : [] };   // '' never reaches a UUID column
}
export async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof CommunityError) throw new HttpException({ ok: false, code: e.code, ...(e.extra || {}) }, e.status); throw e; }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CommunityControllerListQueries)
@Controller('community')
export class CommunityController {
  constructor(@Inject(CommunityService) private readonly svc: CommunityService) {}

  // ── settings + rules ──
  @Get('settings') @RequirePermission('community.feed.view')
  settings(@Req() r: any) { return run(() => this.svc.getSettings(tctx(r))); }

  @Put('settings') @RequirePermission('community.settings.manage')
  updateSettings(@Req() r: any, @Body(ValidatedBody(COMMUNITY_SETTINGS_BODY)) b: any) { return run(() => this.svc.updateSettings(tctx(r), b)); }

  /** Safety Community 08: which community actions each default staff role could take here (read-only, settings managers) */
  @Get('role-preview') @RequirePermission('community.settings.manage')
  rolePreview(@Req() r: any): Promise<CommunityRolePreview> { return run(() => this.svc.rolePreview(tctx(r))); }

  /** Safety Community 09: the sanitized diagnostics CSV (settings + counts only, one range ≤ 92 days, audited before it leaves) */
  @AsyncExport({ kind: 'community.diagnostics.export' }) @Get('diagnostics/export') @RequirePermission('community.settings.manage')
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="safety-community-diagnostics.csv"')
  diagnosticsExport(@Req() r: any, @Query() q: ListQuery): Promise<string> { return run(() => this.svc.diagnosticsExport(tctx(r), q)); }

  @Post('rules/acknowledge') @HttpCode(200) @RequirePermission('community.feed.view')
  acknowledge(@Req() r: any, @Body(ValidatedBody(COMMUNITY_RULES_ACK_BODY, { strict: true })) b: any) { return run(() => this.svc.acknowledgeRules(tctx(r), b)); }

  // ── feed, search, detail ──
  @Get('feed') @RequirePermission('community.feed.view')
  feed(@Req() r: any, @Query() q: any) { return run(() => this.svc.feed(tctx(r), q)); }

  @Get('search') @RequirePermission('community.feed.view')
  search(@Req() r: any, @Query() q: any) { return run(() => this.svc.feed(tctx(r), q)); }

  @Get('posts/:id') @RequirePermission('community.feed.view')
  view(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getPost(tctx(r), id)); }

  // ── my advisories ──
  @Get('mine') @RequirePermission('community.advisory.draft')
  mine(@Req() r: any, @Query() q: any) { return run(() => this.svc.listMine(tctx(r), q)); }

  @Get('mine/:id') @RequirePermission('community.advisory.draft')
  mineOne(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getMine(tctx(r), id)); }

  @Post('advisories/assist') @HttpCode(200) @RequirePermission('community.advisory.draft')
  assist(@Req() r: any, @Body(ValidatedBody(COMMUNITY_ASSIST_BODY, { strict: true })) b: any) { return run(() => this.svc.assist(tctx(r), b)); }

  @Post('advisories') @RequirePermission('community.advisory.draft')
  create(@Req() r: any, @Body(ValidatedBody(COMMUNITY_ADVISORY_CREATE_BODY, { strict: true })) b: any) { return run(() => this.svc.createAdvisory(tctx(r), b)); }

  @Put('advisories/:id') @RequirePermission('community.advisory.draft')
  update(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_ADVISORY_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.updateAdvisory(tctx(r), id, b)); }

  @Post('advisories/:id/submit') @HttpCode(200) @RequirePermission('community.advisory.draft')
  submit(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_SUBMIT_BODY, { strict: true })) b: any) { return run(() => this.svc.submitAdvisory(tctx(r), id, b)); }

  @Post('advisories/:id/approve') @HttpCode(200) @RequirePermission('community.advisory.approve')
  approve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_VERSIONED_BODY, { strict: true })) b: any) { return run(() => this.svc.approveAdvisory(tctx(r), id, b)); }

  @Post('advisories/:id/return') @HttpCode(200) @RequirePermission('community.advisory.approve')
  returnForCorrection(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_VERSIONED_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.returnAdvisory(tctx(r), id, b)); }

  @Post('advisories/:id/withdraw') @HttpCode(200) @RequirePermission('community.advisory.draft')
  withdraw(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_VERSIONED_BODY, { strict: true })) b: any) { return run(() => this.svc.withdrawAdvisory(tctx(r), id, b)); }

  // ── the posting salon's published advisory ──
  @Put('posts/:id') @RequirePermission('community.advisory.submit')
  edit(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_ADVISORY_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.editPublished(tctx(r), id, b)); }

  @Post('posts/:id/updates') @RequirePermission('community.advisory.submit')
  addUpdate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_POST_UPDATE_BODY, { strict: true })) b: any) { return run(() => this.svc.addUpdate(tctx(r), id, b)); }

  @Post('posts/:id/resolve') @HttpCode(200) @RequirePermission('community.advisory.submit')
  resolve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_VERSIONED_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.resolvePost(tctx(r), id, b)); }

  // ── reports, disputes, appeals ──
  @Post('posts/:id/report') @HttpCode(200) @RequirePermission('community.report.create')
  report(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_REPORT_BODY, { strict: true })) b: any) { return run(() => this.svc.reportPost(tctx(r), id, b)); }

  @Post('posts/:id/dispute') @HttpCode(200) @RequirePermission('community.dispute.create')
  dispute(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_DISPUTE_BODY, { strict: true })) b: any) { return run(() => this.svc.disputePost(tctx(r), id, b)); }

  @Post('posts/:id/appeal') @RequirePermission('community.appeal.create')
  appeal(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_APPEAL_BODY, { strict: true })) b: any) { return run(() => this.svc.fileAppeal(tctx(r), id, b)); }

  @Get('appeals') @RequirePermission('community.appeal.create')
  appeals(@Req() r: any) { return run(() => this.svc.listAppeals(tctx(r))); }

  // ── private incidents (own salon only) ──
  /** Safety Community 06: Corrections & Retractions inbox — own published advisories changed after publication (read-only) */
  @Get('corrections') @RequirePermission('community.appeal.create')
  corrections(@Req() r: any, @Query() q: any): Promise<CommunityCorrectionsInbox> { return run(() => this.svc.correctionsInbox(tctx(r), q)); }

  @Get('incidents') @RequirePermission('community.incident.create')
  incidents(@Req() r: any, @Query() q: any) { return run(() => this.svc.listIncidents(tctx(r), q)); }

  @Post('incidents') @RequirePermission('community.incident.create')
  createIncident(@Req() r: any, @Body(ValidatedBody(COMMUNITY_INCIDENT_BODY, { strict: true })) b: any) { return run(() => this.svc.createIncident(tctx(r), b)); }

  @Get('incidents/:id') @RequirePermission('community.incident.create')
  incident(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.getIncident(tctx(r), id)); }
}
