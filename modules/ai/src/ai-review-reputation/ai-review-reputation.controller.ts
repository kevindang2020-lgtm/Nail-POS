// ai-review-reputation.controller.ts — tenant POS surface. Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch/
// role/permissions come from req.ctx (never body/query). @RequirePermission uses granular pos.ai_review_reputation.* keys
// (mapped to marketing in security-core). The service's stable error codes are mapped to HTTP via the error taxonomy.
// Nothing here issues refunds/credits/loyalty/discounts — recovery only records recommendations.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { REVIEW_ASSIGN_BODY, REVIEW_DRAFT_BODY, REVIEW_NOTE_BODY, REVIEW_RECOVERY_BODY, REVIEW_REJECT_BODY, REVIEW_RESOLVE_BODY, REVIEW_SETTINGS_BODY, REVIEW_SYNC_BODY } from '../request-schemas';
import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards, HttpException } from '@nestjs/common';
import { RequiresAiPackage } from '../ai-entitlement/ai-entitlement.guard';
import { AiReviewReputationService, ReputationForbiddenError, type RepCtx } from './ai-review-reputation.service';
import { mapErrorToHttp, errorCode } from './ai-review-reputation-errors';
import { ListQueries } from '@aipowersalon/database';
import { AiReviewReputationControllerListQueries } from './ai-review-reputation.list-queries';

function ctxFrom(req: any): RepCtx {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ReputationForbiddenError) throw new HttpException(e.message, mapErrorToHttp(e.message));
    const code = errorCode(e);
    const body: any = { error: code }; if ((e as any)?.violations) body.violations = (e as any).violations;
    throw new HttpException(body, mapErrorToHttp(code));
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
// Gated on the tenant's AI subscription. Ships in OBSERVE mode: the call still runs, but a tenant who is
// unsubscribed / expired / over-limit is RECORDED as a would-be denial in ai_usage_logs. Nobody's access
// changes until AI_ENTITLEMENT_ENFORCEMENT=enforce is set deliberately - see ai-entitlement.guard.ts.
@RequiresAiPackage('ai_review_reputation_assistant')
@ListQueries(AiReviewReputationControllerListQueries)
@Controller('pos/ai-review-reputation')
export class AiReviewReputationController {
  constructor(private readonly svc: AiReviewReputationService) {}

  // ---- reads ----
  @Get('inbox') @RequirePermission('pos.ai_review_reputation.view')
  inbox(@Req() r: any, @Query() q: any) { return run(() => this.svc.inbox(ctxFrom(r), q || {})); }

  @Get('settings') @RequirePermission('pos.ai_review_reputation.view')
  getSettings(@Req() r: any) { return run(() => this.svc.getSettings(ctxFrom(r))); }

  @Get('analytics') @RequirePermission('pos.ai_review_reputation.view')
  analytics(@Req() r: any, @Query() q: any) { return run(() => this.svc.analytics(ctxFrom(r), { from: q?.from, to: q?.to, branchId: q?.branchId }, q?.prevFrom ? { from: q.prevFrom, to: q.prevTo } : undefined)); }

  @Get('branch-comparison') @RequirePermission('pos.ai_review_reputation.view')
  branchComparison(@Req() r: any, @Query() q: any) { return run(() => this.svc.branchComparison(ctxFrom(r), { from: q?.from, to: q?.to })); }

  @Get('escalations/urgent') @RequirePermission('pos.ai_review_reputation.view')
  urgentQueue(@Req() r: any) { return run(() => this.svc.urgentQueue(ctxFrom(r))); }

  @Get('integration-status') @RequirePermission('pos.ai_review_reputation.view')
  integrationStatus(@Req() r: any) { return run(() => this.svc.integrationStatus(ctxFrom(r))); }

  @Get(':id') @RequirePermission('pos.ai_review_reputation.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.detail(ctxFrom(r), id)); }

  // ---- sync ----
  @Post('sync') @RequirePermission('pos.ai_review_reputation.manage')
  sync(@Req() r: any, @Body(ValidatedBody(REVIEW_SYNC_BODY)) b: any) { return run(() => this.svc.sync(ctxFrom(r), String(b?.source || ''), b?.since ?? null)); }

  // ---- drafting / approval ----
  @Post(':id/draft') @RequirePermission('pos.ai_review_reputation.manage')
  draft(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_DRAFT_BODY)) b: any) { return run(() => this.svc.draft(ctxFrom(r), id, b?.directive || 'generate', { text: b?.reviewText ?? null })); }

  @Post(':id/request-approval') @RequirePermission('pos.ai_review_reputation.manage')
  requestApproval(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.requestApproval(ctxFrom(r), id)); }

  @Post(':id/approve') @RequirePermission('pos.ai_review_reputation.manage')
  approve(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.approve(ctxFrom(r), id)); }

  @Post(':id/reject') @RequirePermission('pos.ai_review_reputation.manage')
  reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_REJECT_BODY)) b: any) { return run(() => this.svc.reject(ctxFrom(r), id, String(b?.reason || ''))); }

  @Post(':id/publish') @RequirePermission('pos.ai_review_reputation.manage')
  publish(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.publish(ctxFrom(r), id)); }

  // ---- escalation / recovery ----
  @Post('escalations/:id/acknowledge') @RequirePermission('pos.ai_review_reputation.manage')
  acknowledge(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.acknowledge(ctxFrom(r), id)); }

  @Post('escalations/:id/assign') @RequirePermission('pos.ai_review_reputation.manage')
  assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_ASSIGN_BODY)) b: any) { return run(() => this.svc.assign(ctxFrom(r), id, String(b?.userId || ''))); }

  @Post('escalations/:id/resolve') @RequirePermission('pos.ai_review_reputation.manage')
  resolve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_RESOLVE_BODY)) b: any) { return run(() => this.svc.resolve(ctxFrom(r), id, String(b?.reviewId || ''))); }

  @Post(':id/recovery') @RequirePermission('pos.ai_review_reputation.manage')
  recordRecovery(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_RECOVERY_BODY)) b: any) { return run(() => this.svc.recordRecovery(ctxFrom(r), id, b?.type)); }

  @Post(':id/notes') @RequirePermission('pos.ai_review_reputation.manage')
  addNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_NOTE_BODY)) b: any) { return run(() => this.svc.addNote(ctxFrom(r), id, String(b?.note || ''))); }

  // ---- settings ----
  @Put('settings') @RequirePermission('pos.ai_review_reputation.manage')
  updateSettings(@Req() r: any, @Body(ValidatedBody(REVIEW_SETTINGS_BODY)) b: any) { return run(() => this.svc.updateSettings(ctxFrom(r), b?.level === 'branch' ? 'branch' : 'tenant', b?.branchId ?? null, typeof b?.enabled === 'boolean' ? b.enabled : null, b?.config ?? null)); }
}
