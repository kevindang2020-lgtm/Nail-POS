// community-interactions.controller.ts — BUILD_PLAN Phase 8 (agent C): comments, similar experiences, follows,
// evidence, the emergency banner and the salon's analytics under /community. TenantAuthGuard + RolePermissionGuard;
// tenant, branch, user and role come from req.ctx (the server-side session), never from the client. Each route's
// community.* key gates the role; the service applies the deeper rules through COMMUNITY_CORE. CommunityError → HTTP
// `{ ok: false, code, ... }` with its status.
import { branchOrNull } from '@aipowersalon/tenant-context';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { COMMUNITY_COMMENT_BODY, COMMUNITY_COMMENT_EDIT_BODY, COMMUNITY_EVIDENCE_UPLOAD_BODY, COMMUNITY_FOLLOW_BODY, COMMUNITY_REPORT_BODY, COMMUNITY_SIMILAR_BODY } from '../request-schemas';
import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type {
  CommunityActiveAlert, CommunityCommentView, CommunityEvidenceAccess, CommunityEvidenceUploadTicket, CommunityEvidenceView,
  CommunityFollowView, CommunityTenantAnalytics,
} from '@aipowersalon/api-contracts/tenant';
import { CommunityError } from './community.service';
import { CommunityInteractionsService } from './community-interactions.service';
import type { CommunityCtx } from './community.repository';
import { ListQueries } from '@aipowersalon/database';
import { CommunityInteractionsControllerListQueries } from './community-interactions.list-queries';

export function interactionsCtx(req: any): CommunityCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: branchOrNull(c.branchId), userId: c.userId, role: c.role, permissions: Array.isArray(c.permissions) ? c.permissions : [] };   // '' never reaches a UUID column
}
export async function runCommunity<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    // the storage adapter's own "no bucket" error is the same honest 503 as the service's
    const ce = e instanceof CommunityError ? e : e && (e as any).name === 'EvidenceStorageNotConfigured' ? new CommunityError('evidence_storage_not_configured', 503) : null;
    if (ce) throw new HttpException({ ok: false, code: ce.code, ...(ce.extra || {}) }, ce.status);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(CommunityInteractionsControllerListQueries)
@Controller('community')
export class CommunityInteractionsController {
  constructor(@Inject(CommunityInteractionsService) private readonly svc: CommunityInteractionsService) {}

  // ── comments ──
  @Get('posts/:id/comments') @RequirePermission('community.feed.view')
  comments(@Req() r: any, @Param('id') id: string): Promise<CommunityCommentView[]> { return runCommunity(() => this.svc.listComments(interactionsCtx(r), id)); }

  @Post('posts/:id/comments') @RequirePermission('community.comment.create')
  addComment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_COMMENT_BODY, { strict: true })) b: any): Promise<CommunityCommentView> {
    return runCommunity(() => this.svc.addComment(interactionsCtx(r), id, { body: b?.body, parentId: b?.parentId }));
  }

  @Put('comments/:id') @RequirePermission('community.comment.create')
  editComment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_COMMENT_EDIT_BODY, { strict: true })) b: any): Promise<CommunityCommentView> {
    return runCommunity(() => this.svc.editComment(interactionsCtx(r), id, { body: b?.body, expectedVersion: b?.expectedVersion }));
  }

  @Delete('comments/:id') @RequirePermission('community.comment.create')
  deleteComment(@Req() r: any, @Param('id') id: string): Promise<{ ok: true; removed: true }> { return runCommunity(() => this.svc.deleteComment(interactionsCtx(r), id)); }

  @Post('comments/:id/report') @HttpCode(200) @RequirePermission('community.report.create')
  reportComment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_REPORT_BODY, { strict: true })) b: any): Promise<{ ok: true }> {
    return runCommunity(() => this.svc.reportComment(interactionsCtx(r), id, { reason: b?.reason, detail: b?.detail }));
  }

  // ── similar experience ──
  @Post('posts/:id/similar') @HttpCode(200) @RequirePermission('community.report.create')
  similar(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMMUNITY_SIMILAR_BODY, { strict: true })) b: any): Promise<{ similarCount: number; mine: true }> {
    return runCommunity(() => this.svc.markSimilar(interactionsCtx(r), id, { note: b?.note, occurredOn: b?.occurredOn }));
  }

  // ── follows ──
  @Post('posts/:id/follow') @HttpCode(200) @RequirePermission('community.follow')
  follow(@Req() r: any, @Param('id') id: string): Promise<{ following: boolean; followers: number }> { return runCommunity(() => this.svc.followPost(interactionsCtx(r), id)); }

  @Delete('posts/:id/follow') @RequirePermission('community.follow')
  unfollow(@Req() r: any, @Param('id') id: string): Promise<{ following: boolean; followers: number }> { return runCommunity(() => this.svc.unfollowPost(interactionsCtx(r), id)); }

  @Get('follows') @RequirePermission('community.follow')
  follows(@Req() r: any): Promise<CommunityFollowView[]> { return runCommunity(() => this.svc.listFollows(interactionsCtx(r))); }

  @Post('follows') @RequirePermission('community.follow')
  createFollow(@Req() r: any, @Body(ValidatedBody(COMMUNITY_FOLLOW_BODY, { strict: true })) b: any): Promise<CommunityFollowView> {
    return runCommunity(() => this.svc.createFollow(interactionsCtx(r), { category: b?.category, region: b?.region, severityMin: b?.severityMin, channels: b?.channels }));
  }

  @Delete('follows/:id') @RequirePermission('community.follow')
  deleteFollow(@Req() r: any, @Param('id') id: string): Promise<{ ok: true }> { return runCommunity(() => this.svc.deleteFollow(interactionsCtx(r), id)); }

  // ── evidence (own salon only) ──
  @Post('evidence/uploads') @RequirePermission('community.evidence.upload')
  requestUpload(@Req() r: any, @Body(ValidatedBody(COMMUNITY_EVIDENCE_UPLOAD_BODY, { strict: true })) b: any): Promise<CommunityEvidenceUploadTicket> {
    return runCommunity(() => this.svc.requestUpload(interactionsCtx(r), { postId: b?.postId, incidentId: b?.incidentId, mimeType: b?.mimeType, sizeBytes: b?.sizeBytes, sha256: b?.sha256 }));
  }

  @Post('evidence/:id/complete') @HttpCode(200) @RequirePermission('community.evidence.upload')
  completeUpload(@Req() r: any, @Param('id') id: string): Promise<CommunityEvidenceView> { return runCommunity(() => this.svc.completeUpload(interactionsCtx(r), id)); }

  @Get('posts/:id/evidence') @RequirePermission('community.evidence.upload')
  evidence(@Req() r: any, @Param('id') id: string): Promise<CommunityEvidenceView[]> { return runCommunity(() => this.svc.listEvidence(interactionsCtx(r), id)); }

  @Get('evidence/:id/access') @RequirePermission('community.evidence.upload')
  evidenceAccess(@Req() r: any, @Param('id') id: string, @Query('reason') reason: string): Promise<CommunityEvidenceAccess> {
    return runCommunity(() => this.svc.accessEvidence(interactionsCtx(r), id, reason));
  }

  // ── banner + analytics ──
  @Get('alerts/active') @RequirePermission('community.feed.view')
  activeAlerts(@Req() r: any): Promise<CommunityActiveAlert[]> { return runCommunity(() => this.svc.activeAlerts(interactionsCtx(r))); }

  @Get('analytics') @RequirePermission('community.settings.manage')
  analytics(@Req() r: any, @Query('from') from: string, @Query('to') to: string): Promise<CommunityTenantAnalytics> {
    return runCommunity(() => this.svc.analytics(interactionsCtx(r), { from, to }));
  }
}
