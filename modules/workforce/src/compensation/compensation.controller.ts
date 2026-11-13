import { RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
/**
 * compensation.controller.ts — owner-facing compensation config surface (/owner/compensation/*). Thin + pure-compute:
 * preview an example calculation (§28), validate a policy before publishing (§27), preview a guarantee top-up. Gated on
 * the owner role / compensation permission (§30) — no tenant data is read or written here, calculation only.
 */
import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req, HttpException, HttpStatus, Optional } from '@nestjs/common';
import type { ServiceCompensationPreviewResponse, DealCommissionReviewListResponse, DealCommissionReviewItem } from '@aipowersalon/api-contracts/tenant';
import { DealCommissionReviewService } from './deal-commission-review';
import { ServiceCompensationPreviewService } from './compensation-service-preview';
import { CompensationPreviewService } from './compensation-preview.service';
import { CompensationReportsService } from './compensation-reports.service';
import { CompensationTipPolicyService } from './compensation-tip-policy.service';
import { RetailCommissionService } from './compensation-retail-policy.service';
import { CompensationRulesService } from './compensation-rules.service';
import { TierPlansService } from './compensation-tier-plans.service';
import { BonusRulesService } from './compensation-bonus-rules.service';
import { ComplianceService } from './compensation-compliance.service';
import { AgreementsService } from './compensation-agreements.service';
import { ListQueries } from '@aipowersalon/database';
import { CompensationControllerListQueries } from './compensation.list-queries';
import { COMP_AGREEMENT_BODY, COMP_BONUS_APPROVE_BODY, COMP_BONUS_PREVIEW_BODY, COMP_BONUS_RULE_BODY, COMP_CLASSIFICATION_BODY, COMP_COMPLIANCE_PREVIEW_BODY, COMP_DEAL_REVIEW_APPROVE_BODY, COMP_GUARANTEE_PREVIEW_BODY, COMP_PERIOD_REVIEW_BODY, COMP_PREVIEW_BODY, COMP_RETAIL_POLICY_BODY, COMP_RULE_ACTIVATE_BODY, COMP_RULE_CREATE_BODY, COMP_RULE_VERSION_BODY, COMP_SEED_DEFAULT_BODY, COMP_SUPPLY_PREVIEW_BODY, COMP_TIER_PLAN_BODY, COMP_TIER_PREVIEW_BODY, COMP_TIP_POLICY_BODY, COMP_VALIDATE_BODY, COMP_WAGE_CONFIG_BODY } from '../request-schemas';

// BUILD_PLAN Phase 9 (Constitution 2, bug 6): every route carries @RequirePermission('compensation.view_all' | 'compensation.manage')
// — keys now in the catalog, held by the OWNER (as the `role === 'OWNER'` shortcut allowed before; no other salon role
// was ever let in). The in-handler gates re-check the same keys (defence in depth); the OWNER / SUPER_ADMIN role
// shortcuts are gone — a Super Admin session is never accepted on /owner anyway (realm).
function gate(req: any) {
  const perms: string[] = req?.ctx?.permissions || [];
  const ok = perms.includes('compensation.manage') || perms.includes('compensation.view_all');
  if (!ok) throw new ForbiddenException('Compensation configuration requires owner access');
}

// Authoring rules is a WRITE — requires manage (read-only compensation.view_all is not enough).
function gateManage(req: any) {
  const ok = (req?.ctx?.permissions || []).includes('compensation.manage');
  if (!ok) throw new ForbiddenException('Editing compensation rules requires owner access');
}
function rc(req: any) { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, userName: c.fullName || c.name || c.email }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) { if ((e as any)?.code === 'INVALID_STATE_TRANSITION') throw e;   // Phase 12: the filter answers 409 with the code + details
    if (e instanceof Error && typeof (e as any).status === 'number') throw new HttpException((e as any).code ? { code: (e as any).code, message: e.message } : e.message, (e as any).status || HttpStatus.BAD_REQUEST); throw e; }
}
function range(q: any): { from: string; to: string; branchId?: string } { return { from: q?.from || new Date(Date.now() - 30 * 864e5).toISOString(), to: q?.to || new Date().toISOString(), branchId: q?.branchId }; }

@ListQueries(CompensationControllerListQueries)
@Controller('owner/compensation')
export class CompensationController {
  constructor(private readonly svc: CompensationPreviewService, private readonly reports: CompensationReportsService, private readonly tipPolicy: CompensationTipPolicyService, private readonly rules: CompensationRulesService, private readonly tierPlans: TierPlansService, private readonly retail: RetailCommissionService, private readonly bonuses: BonusRulesService, private readonly compliance: ComplianceService, private readonly agreements: AgreementsService, @Optional() private readonly servicePreview?: ServiceCompensationPreviewService, @Optional() private readonly dealReviews?: DealCommissionReviewService) {}

  // §19 compensation agreements (owner captures + lists; technician acknowledges elsewhere).
  @RequirePermission('compensation.view_all') @Get('agreements') agreementsList(@Req() r: any, @Query('technicianId') technicianId?: string) { gate(r); return run(() => this.agreements.list(rc(r), technicianId)); }
  @RequirePermission('compensation.manage') @Post('agreements') agreementCreate(@Req() r: any, @Body(ValidatedBody(COMP_AGREEMENT_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.agreements.create(rc(r), b || {})); }

  // §18 worker classification (owner input) + wage-compliance config + review preview (flags exceptions; never enforces).
  @RequirePermission('compensation.view_all') @Get('classifications') classificationsList(@Req() r: any) { gate(r); return run(() => this.compliance.listClassifications(rc(r))); }
  @RequirePermission('compensation.manage') @Put('classifications/:technicianId') classificationSet(@Req() r: any, @Param('technicianId') technicianId: string, @Body(ValidatedBody(COMP_CLASSIFICATION_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.compliance.setClassification(rc(r), technicianId, b?.classification)); }
  @RequirePermission('compensation.view_all') @Get('wage-config') wageConfigGet(@Req() r: any) { gate(r); return run(() => this.compliance.getWageConfig(rc(r))); }
  @RequirePermission('compensation.manage') @Put('wage-config') wageConfigSet(@Req() r: any, @Body(ValidatedBody(COMP_WAGE_CONFIG_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.compliance.setWageConfig(rc(r), b || {})); }
  @RequirePermission('compensation.view_all') @Post('compliance-preview') compliancePreview(@Req() r: any, @Body(ValidatedBody(COMP_COMPLIANCE_PREVIEW_BODY, { strict: true })) b: any) { gate(r); return run(() => this.compliance.previewCompliance(rc(r), { technicianId: b?.technicianId, periodPayCents: b?.periodPayCents, hoursWorked: b?.hoursWorked })); }
  @RequirePermission('compensation.view_all') @Post('compliance-period-review') compliancePeriodReview(@Req() r: any, @Body(ValidatedBody(COMP_PERIOD_REVIEW_BODY, { strict: true })) b: any) { gate(r); return run(() => this.compliance.reviewPeriod(rc(r), b?.periodId)); }

  // §17 target-based bonuses (per technician or salon-wide) + preview (recommendation; approval/payout is separate).
  @RequirePermission('compensation.view_all') @Get('bonus-rules') bonusRulesList(@Req() r: any) { gate(r); return run(() => this.bonuses.list(rc(r))); }
  @RequirePermission('compensation.manage') @Post('bonus-rules') bonusRulesCreate(@Req() r: any, @Body(ValidatedBody(COMP_BONUS_RULE_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.bonuses.create(rc(r), b || {})); }
  @RequirePermission('compensation.view_all') @Post('bonus-rules/preview') bonusRulesPreview(@Req() r: any, @Body(ValidatedBody(COMP_BONUS_PREVIEW_BODY, { strict: true })) b: any) { gate(r); return run(() => this.bonuses.previewForTechnician(rc(r), { technicianId: b?.technicianId, fromIso: b?.fromIso, toIso: b?.toIso })); }
  @RequirePermission('compensation.view_all') @Post('bonus-rules/period-review') bonusRulesPeriodReview(@Req() r: any, @Body(ValidatedBody(COMP_PERIOD_REVIEW_BODY, { strict: true })) b: any) { gate(r); return run(() => this.bonuses.reviewPeriod(rc(r), b?.periodId)); }
  @RequirePermission('compensation.manage') @Post('bonus-rules/:id/archive') bonusRuleArchive(@Req() r: any, @Param('id') id: string) { gateManage(r); return run(() => this.bonuses.archive(rc(r), id)); }
  @RequirePermission('compensation.manage') @Post('bonus-rules/approve') bonusApprove(@Req() r: any, @Body(ValidatedBody(COMP_BONUS_APPROVE_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.bonuses.approveBonus(rc(r), b || {})); }

  // §16 salon retail commission rate (percent of gross / fixed per item). Read allows view_all; write requires manage.
  @RequirePermission('compensation.view_all') @Get('retail-policy') retailPolicyGet(@Req() r: any) { gate(r); return this.retail.get({ tenantId: r.ctx.tenantId, branchId: r.ctx.branchId ?? null, userId: r.ctx.userId }); }
  @RequirePermission('compensation.manage') @Put('retail-policy') retailPolicySet(@Req() r: any, @Body(ValidatedBody(COMP_RETAIL_POLICY_BODY, { strict: true })) b: any) { gateManage(r); return this.retail.set({ tenantId: r.ctx.tenantId, branchId: r.ctx.branchId ?? null, userId: r.ctx.userId }, b); }

  // Salon 3+-technician tip-split policy (spec §11). Default 'proportional'; 'equal' only when explicitly enabled.
  @RequirePermission('compensation.view_all') @Get('tip-policy') tipPolicyGet(@Req() r: any) { gate(r); return this.tipPolicy.get({ tenantId: r.ctx.tenantId, branchId: r.ctx.branchId ?? null, userId: r.ctx.userId }); }
  @RequirePermission('compensation.manage') @Put('tip-policy') tipPolicySet(@Req() r: any, @Body(ValidatedBody(COMP_TIP_POLICY_BODY, { strict: true })) b: any) { gateManage(r); return this.tipPolicy.set({ tenantId: r.ctx.tenantId, branchId: r.ctx.branchId ?? null, userId: r.ctx.userId }, b?.manyTechTipMethod); }

  @RequirePermission('compensation.view_all') @Post('preview') preview(@Req() r: any, @Body(ValidatedBody(COMP_PREVIEW_BODY, { strict: true })) body: any) {
    gate(r);
    // w4 sweep SW-03: the engine reads serviceLines unguarded — a body without it was a TypeError (500)
    if (!Array.isArray(body?.serviceLines)) throw new HttpException({ code: 'VALIDATION_FAILED', message: 'serviceLines is required (one entry per service line).' }, HttpStatus.BAD_REQUEST);
    return this.svc.preview(body);
  }

  @RequirePermission('compensation.view_all') @Post('supply/preview') supplyPreview(@Req() r: any, @Body(ValidatedBody(COMP_SUPPLY_PREVIEW_BODY, { strict: true })) body: any) {
    gate(r);
    return this.svc.supplyPreview(body?.config, Number(body?.priceCents || 0));
  }

  @RequirePermission('compensation.view_all') @Post('guarantee/preview') guaranteePreview(@Req() r: any, @Body(ValidatedBody(COMP_GUARANTEE_PREVIEW_BODY, { strict: true })) body: any) {
    gate(r);
    return this.svc.guaranteePreview(body?.policy, body?.facts || {}, body?.earnings || {}, body?.manualProratedCents);
  }

  @RequirePermission('compensation.view_all') @Post('validate') validate(@Req() r: any, @Body(ValidatedBody(COMP_VALIDATE_BODY, { strict: true })) body: any) {
    gate(r);
    return this.svc.validate(body?.rule || {}, body?.supply);
  }

  // SERVICE PRICING 12: one service at its current and a proposed price — each technician's rate by the money path's
  // precedence (with its source) and the engine's earnings at both prices, plus the sources of the actual payouts. Read only.
  @RequirePermission('compensation.view_all') @Get('service-preview') async servicePreviewGet(@Req() r: any, @Query() q: any): Promise<ServiceCompensationPreviewResponse> {
    gate(r);
    const svc = this.servicePreview;
    if (!svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Compensation preview needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);
    return run(() => svc.preview(rc(r), { serviceId: q?.serviceId, priceCents: q?.priceCents }));
  }
  // Extras · Deals & Offers 12: Commission Impact Review — which deals' commission impact is not approved (read), and the
  // append-only approval of one deal version (write; never edits a deal, a ticket or anyone's pay).
  @RequirePermission('compensation.view_all') @Get('deal-reviews') async dealReviewsList(@Req() r: any, @Query() q: any): Promise<DealCommissionReviewListResponse> {
    gate(r);
    const svc = this.dealReviews;
    if (!svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Commission impact review needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);
    return run(() => svc.list(rc(r), { flagged: q?.flagged, page: q?.page, pageSize: q?.pageSize }));
  }
  @RequirePermission('compensation.manage') @Post('deal-reviews/:dealId/approve') async dealReviewApprove(@Req() r: any, @Param('dealId') dealId: string, @Body(ValidatedBody(COMP_DEAL_REVIEW_APPROVE_BODY, { strict: true })) b: any): Promise<DealCommissionReviewItem> {
    gateManage(r);
    const svc = this.dealReviews;
    if (!svc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Commission impact review needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE);
    return run(() => svc.approve(rc(r), dealId, { note: b?.note }));
  }
  @RequirePermission('compensation.view_all') @Get('reports/commission') reportCommission(@Req() r: any, @Query() q: any) { gate(r); const g = range(q); return this.reports.commission(r.ctx.tenantId, g.from, g.to, g.branchId); }
  @RequirePermission('compensation.view_all') @Get('reports/supply') reportSupply(@Req() r: any, @Query() q: any) { gate(r); const g = range(q); return this.reports.supply(r.ctx.tenantId, g.from, g.to, g.branchId); }
  @RequirePermission('compensation.view_all') @Get('reports/tips') reportTips(@Req() r: any, @Query() q: any) { gate(r); const g = range(q); return this.reports.tips(r.ctx.tenantId, g.from, g.to, g.branchId); }

  // §5/§7/§25 rule authoring. Reads allow view_all; writes require manage. Preview reuses POST /preview above (no new formula).
  @RequirePermission('compensation.view_all') @Get('rules') rulesList(@Req() r: any) { gate(r); return run(() => this.rules.list(rc(r))); }
  @RequirePermission('compensation.manage') @Post('rules') rulesCreate(@Req() r: any, @Body(ValidatedBody(COMP_RULE_CREATE_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.rules.createPolicy(rc(r), b || {})); }
  @RequirePermission('compensation.manage') @Post('rules/seed-default') seedDefault(@Req() r: any, @Body(ValidatedBody(COMP_SEED_DEFAULT_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.rules.seedDefaultTemplate(rc(r), { technicianPercent: b?.technicianPercent })); }
  @RequirePermission('compensation.manage') @Post('rules/:id/versions') ruleAddVersion(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMP_RULE_VERSION_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.rules.addVersion(rc(r), id, b?.version ?? b)); }
  @RequirePermission('compensation.manage') @Post('versions/:id/approve') versionApprove(@Req() r: any, @Param('id') id: string) { gateManage(r); return run(() => this.rules.approve(rc(r), id)); }
  // Activation prices every future line → requires the Super Admin commission authorization code (body.adminAuthCode), like the POS commission edits.
  @RequirePermission('compensation.manage') @Post('versions/:id/activate') versionActivate(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COMP_RULE_ACTIVATE_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.rules.activate(rc(r), id, b?.adminAuthCode)); }
  @RequirePermission('compensation.manage') @Post('versions/:id/cancel') versionCancel(@Req() r: any, @Param('id') id: string) { gateManage(r); return run(() => this.rules.cancel(rc(r), id)); }

  // §2 tiered plans (per technician) + §20 preview. Reads allow view_all; writes require manage.
  @RequirePermission('compensation.view_all') @Get('tier-plans') tierPlansList(@Req() r: any) { gate(r); return run(() => this.tierPlans.list(rc(r))); }
  @RequirePermission('compensation.manage') @Post('tier-plans') tierPlansCreate(@Req() r: any, @Body(ValidatedBody(COMP_TIER_PLAN_BODY, { strict: true })) b: any) { gateManage(r); return run(() => this.tierPlans.create(rc(r), b || {})); }
  @RequirePermission('compensation.view_all') @Post('tier-plans/preview') tierPlansPreview(@Req() r: any, @Body(ValidatedBody(COMP_TIER_PREVIEW_BODY, { strict: true })) b: any) { gate(r); return run(() => this.tierPlans.preview(b || {})); }
  @RequirePermission('compensation.manage') @Post('tier-plans/:id/archive') tierPlanArchive(@Req() r: any, @Param('id') id: string) { gateManage(r); return run(() => this.tierPlans.archive(rc(r), id)); }
}
