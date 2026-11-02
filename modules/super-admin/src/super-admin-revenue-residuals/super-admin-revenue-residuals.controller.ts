// super-admin-revenue-residuals.controller.ts — SuperAdminGuard-only platform Revenue & Residuals reads.
// Read surface (overview + records list + agreement detail). Agreement create/versioning, residual import,
// reconciliation, payouts, incentives, adjustments, period locking and export are separate audited write units.

import { Body, Controller, Get, HttpException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SuperAdminGuard, AsyncExport, ValidatedBody, RequireStepUp } from '@aipowersalon/permissions/guards';
import { SuperAdminRevenueResidualsService } from './super-admin-revenue-residuals.service';
import { ListQueries } from '@aipowersalon/database';
import { SuperAdminRevenueResidualsControllerListQueries } from './super-admin-revenue-residuals.list-queries';
import { RR_ADJUSTMENT_BODY, RR_AGREEMENT_BODY, RR_EXPORT_JOB_BODY, RR_IMPORT_STATEMENT_BODY, RR_NOTES_BODY, RR_PARTNER_PAYOUT_BODY, RR_PERIOD_BODY, RR_REASON_BODY, RR_REVIEW_STATEMENT_BODY, RR_TENANT_INCENTIVE_BODY, RR_VERSION_BODY } from '../request-schemas-finance';   // BUILD_PLAN Phase 12 (#17)

const str = (v: unknown): string | undefined => { const x = Array.isArray(v) ? v[0] : v; const s = x == null ? '' : String(x); return s.trim() ? s.trim() : undefined; };
const num = (v: unknown, d: number): number => { const x = Number(Array.isArray(v) ? v[0] : v); return Number.isFinite(x) && x > 0 ? Math.trunc(x) : d; };
const actorFrom = (r: any): { id?: string; role?: string } => ({ id: r?.ctx?.userId ?? r?.user?.id ?? undefined, role: r?.ctx?.role ?? r?.user?.role ?? undefined });
const numOrNull = (v: unknown): number | null => { const x = Number(v); return Number.isFinite(x) ? x : null; };

const ERR_MSG: Record<string, string> = {
  overlap: 'An active agreement already covers this scope and effective window.',
  duplicate_code: 'That agreement code already exists.',
  percentages_must_total_100: 'The three percentages must total exactly 100.',
  percentages_required: 'All three percentages are required.',
  effective_date_required: 'An effective date is required.',
  invalid_expiration_date: 'The expiration date is invalid.',
  expiration_before_effective: 'Expiration date cannot precede the effective date.',
  name_required: 'An agreement name is required.',
  agreement_required: 'An agreement is required.',
  not_found: 'Agreement not found.',
  write_failed: 'Could not save the agreement.',
  unavailable: 'Revenue store is not available.',
  processor_required: 'A processor is required.',
  statement_ref_required: 'A statement reference is required.',
  period_required: 'A valid statement period is required.',
  period_end_before_start: 'The period end cannot precede the period start.',
  invalid_status: 'That review status is not allowed.',
  statement_required: 'A statement is required.',
  agreement_has_no_version: 'The agreement has no active version to calculate from.',
  payout_required: 'A payout is required.',
  invalid_state: 'This item cannot be approved in its current state.',
  tenant_required: 'A tenant is required.',
  incentive_required: 'An incentive is required.',
  amount_required: 'A non-zero adjustment amount is required.',
  reason_required: 'A reason is required.',
  invalid_adjustment_type: 'That adjustment type is not allowed.',
  adjustment_required: 'An adjustment is required.',
  period_locked: 'The accounting period is locked; reopen it before adjusting.',
  same_approver: 'A second, distinct approver is required for this high-value adjustment.',
  period_id_required: 'A period is required.',
  duplicate_name: 'A period with that name already exists.',
  already_locked: 'This period is already locked.',
  pending_adjustments: 'Resolve pending adjustments before locking this period.',
  not_locked: 'This period is not locked.',
};
function fail(res: { error: string; status: number; conflict?: string }): never {
  const base = ERR_MSG[res.error] ?? 'Request could not be completed.';
  throw new HttpException({ code: res.error, message: res.conflict ? `${base} (conflict: ${res.conflict})` : base, conflict: res.conflict }, res.status);
}

@ListQueries(SuperAdminRevenueResidualsControllerListQueries)
@Controller('super-admin/revenue-residuals')
@UseGuards(SuperAdminGuard)
export class SuperAdminRevenueResidualsController {
  constructor(private readonly svc: SuperAdminRevenueResidualsService) {}

  @Get('overview')
  overview(@Query('agreementId') agreementId: unknown) {
    return this.svc.overview(str(agreementId));
  }

  @Get('records')
  records(
    @Query('q') q: unknown, @Query('agreementId') agreementId: unknown, @Query('tenantId') tenantId: unknown, @Query('branchId') branchId: unknown,
    @Query('processor') processor: unknown, @Query('startDate') startDate: unknown, @Query('endDate') endDate: unknown,
    @Query('revenueType') revenueType: unknown, @Query('status') status: unknown,
    @Query('page') page: unknown, @Query('pageSize') pageSize: unknown, @Query('sort') sort: unknown, @Query('direction') direction: unknown,
  ) {
    return this.svc.listRecords({
      q: str(q), agreementId: str(agreementId), tenantId: str(tenantId), branchId: str(branchId), processor: str(processor),
      startDate: str(startDate), endDate: str(endDate), revenueType: str(revenueType), status: str(status),
      page: num(page, 1), pageSize: num(pageSize, 10), sort: str(sort), direction: str(direction),
    });
  }

  @Get('agreements/:id')
  agreement(@Param('id') id: string) {
    return this.svc.agreementDetail(String(id));
  }

  @Get('agreements')
  agreements(@Query('q') q: unknown, @Query('tenantId') tenantId: unknown, @Query('processor') processor: unknown, @Query('status') status: unknown) {
    return this.svc.listAgreements({ q: str(q), tenantId: str(tenantId), processor: str(processor), status: str(status) });
  }

  @Get('agreements/:id/versions')
  versions(@Param('id') id: string) {
    return this.svc.listVersions(String(id));
  }

  // ── Add Revenue Rule: create agreement (+ immutable v1) ──
  @Post('agreements')
  async createAgreement(@Req() r: any, @Body(ValidatedBody(RR_AGREEMENT_BODY, { strict: true })) body: any) {
    const res = await this.svc.createAgreement(actorFrom(r), {
      name: body?.name, agreementType: str(body?.agreementType), tenantId: str(body?.tenantId) ?? null, branchId: str(body?.branchId) ?? null,
      processor: str(body?.processor) ?? null, revenueSource: str(body?.revenueSource) ?? null,
      aiPct: body?.aiPct, processorPct: body?.processorPct, salonPct: body?.salonPct,
      effectiveDate: str(body?.effectiveDate), expirationDate: str(body?.expirationDate) ?? null, currency: str(body?.currency),
      roundingPolicy: str(body?.roundingPolicy), refundAllocation: str(body?.refundAllocation),
      minimumVolumeCents: numOrNull(body?.minimumVolumeCents), maximumVolumeCents: numOrNull(body?.maximumVolumeCents),
      status: str(body?.status), changeReason: str(body?.changeReason),
    });
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Add a new immutable version to an existing agreement ──
  @Post('agreements/:id/versions')
  async createVersion(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_VERSION_BODY, { strict: true })) body: any) {
    const res = await this.svc.addVersion(actorFrom(r), String(id), {
      aiPct: body?.aiPct, processorPct: body?.processorPct, salonPct: body?.salonPct,
      effectiveDate: str(body?.effectiveDate), expirationDate: str(body?.expirationDate) ?? null, currency: str(body?.currency),
      roundingPolicy: str(body?.roundingPolicy), refundAllocation: str(body?.refundAllocation), changeReason: str(body?.changeReason),
    });
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Review Residual Statements ──
  @Get('residual-statements')
  statements(@Query('processor') processor: unknown, @Query('tenantId') tenantId: unknown, @Query('reviewStatus') reviewStatus: unknown) {
    return this.svc.listStatements({ processor: str(processor), tenantId: str(tenantId), reviewStatus: str(reviewStatus) });
  }

  @Get('residual-statements/:id')
  statement(@Param('id') id: string) {
    return this.svc.statementDetail(String(id));
  }

  @Get('expense-categories')
  expenseCategories() { return this.svc.expenseCategories(); }

  @Post('residual-statements/import')
  async importStatement(@Req() r: any, @Body(ValidatedBody(RR_IMPORT_STATEMENT_BODY, { strict: true })) body: any) {
    const res = await this.svc.importStatement(actorFrom(r), body ?? {});
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('residual-statements/:id/review')
  async reviewStatement(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_REVIEW_STATEMENT_BODY, { strict: true })) body: any) {
    const res = await this.svc.reviewStatement(actorFrom(r), String(id), String(body?.status ?? ''), str(body?.notes));
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Reconcile Processor Reports ──
  @Get('reconciliations')
  reconciliations(@Query('statementId') statementId: unknown, @Query('status') status: unknown) {
    return this.svc.listReconciliations({ statementId: str(statementId), status: str(status) });
  }

  @Post('residual-statements/:id/reconcile')
  async reconcile(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_NOTES_BODY, { strict: true })) body: any) {
    const res = await this.svc.reconcileStatement(actorFrom(r), String(id), str(body?.notes));
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Calculate Partner Payouts ──
  @Get('partner-payouts')
  partnerPayouts(@Query('processor') processor: unknown, @Query('agreementId') agreementId: unknown, @Query('status') status: unknown) {
    return this.svc.listPartnerPayouts({ processor: str(processor), agreementId: str(agreementId), status: str(status) });
  }

  @Post('partner-payouts/calculate')
  async calculatePartnerPayout(@Req() r: any, @Body(ValidatedBody(RR_PARTNER_PAYOUT_BODY, { strict: true })) body: any) {
    const res = await this.svc.calculatePartnerPayout(actorFrom(r), { agreementId: str(body?.agreementId), periodStart: str(body?.periodStart), periodEnd: str(body?.periodEnd), priorBalanceCents: body?.priorBalanceCents });
    if (!res.ok) fail(res as any);
    return res;
  }

  @RequireStepUp()   // §59 (Oct 28 2026): approving money out needs a fresh step-up
  @Post('partner-payouts/:id/approve')
  async approvePartnerPayout(@Req() r: any, @Param('id') id: string) {
    const res = await this.svc.approvePartnerPayout(actorFrom(r), String(id));
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Calculate Tenant Incentives ──
  @Get('tenant-incentives')
  tenantIncentives(@Query('tenantId') tenantId: unknown, @Query('agreementId') agreementId: unknown, @Query('status') status: unknown) {
    return this.svc.listTenantIncentives({ tenantId: str(tenantId), agreementId: str(agreementId), status: str(status) });
  }

  @Post('tenant-incentives/calculate')
  async calculateTenantIncentive(@Req() r: any, @Body(ValidatedBody(RR_TENANT_INCENTIVE_BODY, { strict: true })) body: any) {
    const res = await this.svc.calculateTenantIncentive(actorFrom(r), { agreementId: str(body?.agreementId), tenantId: str(body?.tenantId), periodStart: str(body?.periodStart), periodEnd: str(body?.periodEnd), priorUnpaidBalanceCents: body?.priorUnpaidBalanceCents });
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('tenant-incentives/:id/approve')
  async approveTenantIncentive(@Req() r: any, @Param('id') id: string) {
    const res = await this.svc.approveTenantIncentive(actorFrom(r), String(id));
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Export Payout Reports (filter-aware, audited CSV) ──
  @AsyncExport({ kind: 'super-admin.revenue-residuals.export' }) @Get('export')
  async export(
    @Req() r: any, @Query('dataset') dataset: unknown, @Query('format') format: unknown,
    @Query('q') q: unknown, @Query('agreementId') agreementId: unknown, @Query('tenantId') tenantId: unknown, @Query('branchId') branchId: unknown,
    @Query('processor') processor: unknown, @Query('startDate') startDate: unknown, @Query('endDate') endDate: unknown,
    @Query('revenueType') revenueType: unknown, @Query('status') status: unknown, @Query('sort') sort: unknown, @Query('direction') direction: unknown,
  ) {
    const res = await this.svc.exportPayoutReports(actorFrom(r), {
      dataset: str(dataset), format: str(format), q: str(q), agreementId: str(agreementId), tenantId: str(tenantId), branchId: str(branchId), processor: str(processor),
      startDate: str(startDate), endDate: str(endDate), revenueType: str(revenueType), status: str(status), sort: str(sort), direction: str(direction),
      page: 1, pageSize: 5000,
    } as any);
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Approve Revenue Adjustments ──
  @Get('revenue-adjustments')
  adjustments(@Query('revenueRecordId') revenueRecordId: unknown, @Query('agreementId') agreementId: unknown, @Query('status') status: unknown) {
    return this.svc.listAdjustments({ revenueRecordId: str(revenueRecordId), agreementId: str(agreementId), status: str(status) });
  }

  @Post('revenue-adjustments')
  async createAdjustment(@Req() r: any, @Body(ValidatedBody(RR_ADJUSTMENT_BODY, { strict: true })) body: any) {
    const res = await this.svc.createAdjustment(actorFrom(r), {
      revenueRecordId: str(body?.revenueRecordId) ?? null, agreementId: str(body?.agreementId) ?? null, accountingPeriodId: str(body?.accountingPeriodId) ?? null,
      tenantId: str(body?.tenantId) ?? null, branchId: str(body?.branchId) ?? null, processor: str(body?.processor) ?? null,
      adjustmentType: str(body?.adjustmentType), amountCents: body?.amountCents, reason: body?.reason, supportingEvidence: str(body?.supportingEvidence) ?? null,
    });
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('revenue-adjustments/:id/approve')
  async approveAdjustment(@Req() r: any, @Param('id') id: string) {
    const res = await this.svc.approveAdjustment(actorFrom(r), String(id));
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('revenue-adjustments/:id/reject')
  async rejectAdjustment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_REASON_BODY, { strict: true })) body: any) {
    const res = await this.svc.rejectAdjustment(actorFrom(r), String(id), str(body?.reason));
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('revenue-adjustments/:id/reverse')
  async reverseAdjustment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_REASON_BODY, { strict: true })) body: any) {
    const res = await this.svc.reverseAdjustment(actorFrom(r), String(id), str(body?.reason));
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Lock Finalized Accounting Periods ──
  @Get('accounting-periods')
  periods(@Query('status') status: unknown) {
    return this.svc.listPeriods({ status: str(status) });
  }

  @Post('accounting-periods')
  async createPeriod(@Req() r: any, @Body(ValidatedBody(RR_PERIOD_BODY, { strict: true })) body: any) {
    const res = await this.svc.createPeriod(actorFrom(r), { name: body?.name, startDate: str(body?.startDate), endDate: str(body?.endDate), currency: str(body?.currency) });
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('accounting-periods/:id/lock')
  async lockPeriod(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_REASON_BODY, { strict: true })) body: any) {
    const res = await this.svc.lockPeriod(actorFrom(r), String(id), str(body?.reason));
    if (!res.ok) fail(res as any);
    return res;
  }

  @Post('accounting-periods/:id/reopen')
  async reopenPeriod(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RR_REASON_BODY, { strict: true })) body: any) {
    const res = await this.svc.reopenPeriod(actorFrom(r), String(id), String(body?.reason ?? ''));
    if (!res.ok) fail(res as any);
    return res;
  }

  // ── Track Unpaid Residuals ──
  @Get('unpaid-residuals')
  unpaidResiduals(@Query('processor') processor: unknown, @Query('tenantId') tenantId: unknown) {
    return this.svc.unpaidResiduals({ processor: str(processor), tenantId: str(tenantId) });
  }

  // ── Revenue Forecast ──
  @Get('forecast')
  forecast(@Query('horizonMonths') horizonMonths: unknown) {
    const h = Number(horizonMonths);
    return this.svc.forecast({ horizonMonths: Number.isFinite(h) ? h : undefined });
  }

  // ── Background export jobs ──
  @Get('export-jobs')
  exportJobs() {
    return this.svc.listExportJobs();
  }

  @Get('export-jobs/:id')
  exportJob(@Param('id') id: string) {
    return this.svc.getExportJob(String(id));
  }

  @Post('export-jobs')
  async enqueueExportJob(@Req() r: any, @Body(ValidatedBody(RR_EXPORT_JOB_BODY, { strict: true })) body: any) {
    const res = await this.svc.enqueueExportJob(actorFrom(r), {
      dataset: str(body?.dataset), format: str(body?.format), q: str(body?.q), agreementId: str(body?.agreementId), tenantId: str(body?.tenantId), branchId: str(body?.branchId),
      processor: str(body?.processor), startDate: str(body?.startDate), endDate: str(body?.endDate), revenueType: str(body?.revenueType), status: str(body?.status),
    } as any);
    if (!res.ok) fail(res as any);
    // BUILD_PLAN Phase 12: the job is also an operation of the ONE async contract (GET /super-admin/operations/:id)
    return { ...res, operationId: res.jobId, statusUrl: `/super-admin/operations/${res.jobId}` };
  }
}
