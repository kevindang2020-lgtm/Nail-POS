// ai-review-reputation.controller.ts — tenant POS surface. Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch/
// role/permissions come from req.ctx (never body/query). @RequirePermission uses granular pos.ai_review_reputation.* keys
// (mapped to marketing in security-core). The service's stable error codes are mapped to HTTP via the error taxonomy.
// Nothing here issues refunds/credits/loyalty/discounts — recovery only records recommendations.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { REVIEW_ASSIGN_BODY, REVIEW_DRAFT_BODY, REVIEW_NOTE_BODY, REVIEW_RECOVERY_BODY, REVIEW_REJECT_BODY, REVIEW_RESOLVE_BODY, REVIEW_SYNC_BODY } from '../request-schemas';
import { Controller, Post, Body, Param, Req, UseGuards, HttpException } from '@nestjs/common';
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
    // §163 run 3 (Oct 27 2026): an error outside the taxonomy goes to the platform filter as it is — a database data
    // exception (a malformed id) is a 400 INVALID_INPUT there; wrapping it here made every one a 500
    if (code === 'INTERNAL_ERROR') throw e;
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
  // inbox · analytics · branch-comparison · escalations/urgent · integration-status · GET :id are retired (Review & Reputation
  // guide, Nov 2 2026): the workspace reads /pos/reputation/* — one metric definition, server pages, no swallowed errors.

  // GET settings / PUT settings are retired (Review & Reputation Settings guide, Nov 2 2026): /pos/reputation-settings/* reads the
  // effective policy with its sources and writes it version-checked, with history and a fail-closed audit.






  // ---- sync ----
  @Post('sync') @RequirePermission('pos.ai_review_reputation.manage')
  sync(@Req() r: any, @Body(ValidatedBody(REVIEW_SYNC_BODY, { strict: true })) b: any) { return run(() => this.svc.sync(ctxFrom(r), String(b?.source || ''), b?.since ?? null)); }

  // ---- drafting / approval ----
  @Post(':id/draft') @RequirePermission('pos.ai_review_reputation.manage')
  draft(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_DRAFT_BODY, { strict: true })) b: any) { return run(() => this.svc.draft(ctxFrom(r), id, b?.directive || 'generate', { text: b?.reviewText ?? null })); }

  @Post(':id/request-approval') @RequirePermission('pos.ai_review_reputation.manage')
  requestApproval(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.requestApproval(ctxFrom(r), id)); }

  @Post(':id/approve') @RequirePermission('pos.ai_review_reputation.manage')
  approve(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.approve(ctxFrom(r), id)); }

  @Post(':id/reject') @RequirePermission('pos.ai_review_reputation.manage')
  reject(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_REJECT_BODY, { strict: true })) b: any) { return run(() => this.svc.reject(ctxFrom(r), id, String(b?.reason || ''))); }

  @Post(':id/publish') @RequirePermission('pos.ai_review_reputation.manage')
  publish(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.publish(ctxFrom(r), id)); }

  // ---- escalation / recovery ----
  @Post('escalations/:id/acknowledge') @RequirePermission('pos.ai_review_reputation.manage')
  acknowledge(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.acknowledge(ctxFrom(r), id)); }

  @Post('escalations/:id/assign') @RequirePermission('pos.ai_review_reputation.manage')
  assign(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_ASSIGN_BODY, { strict: true })) b: any) { return run(() => this.svc.assign(ctxFrom(r), id, String(b?.userId || ''))); }

  @Post('escalations/:id/resolve') @RequirePermission('pos.ai_review_reputation.manage')
  resolve(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_RESOLVE_BODY, { strict: true })) b: any) { return run(() => this.svc.resolve(ctxFrom(r), id, String(b?.reviewId || ''))); }

  @Post(':id/recovery') @RequirePermission('pos.ai_review_reputation.manage')
  recordRecovery(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_RECOVERY_BODY, { strict: true })) b: any) { return run(() => this.svc.recordRecovery(ctxFrom(r), id, b?.type)); }

  @Post(':id/notes') @RequirePermission('pos.ai_review_reputation.manage')
  addNote(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(REVIEW_NOTE_BODY, { strict: true })) b: any) { return run(() => this.svc.addNote(ctxFrom(r), id, String(b?.note || ''))); }

}
