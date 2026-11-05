// payroll.controller.ts — payroll HTTP surface. Thin (mandate §108): authenticate (guards), validate (ValidatedBody),
// authorize (@RequirePermission + the service re-checks), call the service, serialize.
//  • Tenant   /pos/payroll/*          — TenantAuthGuard + RolePermissionGuard, tenant-scoped periods + lines + lifecycle.
//  • Platform /super-admin/payroll    — SuperAdminGuard, cross-tenant payroll overview (safe status only, §166).
// Wave 2 (Oct 12 2026): the review / approval / lock / payout / export workflow (PayrollWorkflowService). Approve, reopen,
// pay, payouts, adjustment decisions and pay-plan changes need a FRESH step-up (§72, StepUpGuard: 403 STEP_UP_REQUIRED →
// the POS asks for the password and retries). Approval keys are their own: payroll.approve / payroll.export /
// payroll.adjust / payouts.manage (§101) — a receptionist holds none (§103, §191).
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, UseGuards, HttpException, HttpStatus, Optional, Inject } from '@nestjs/common';
import { PayrollService, ForbiddenError, ValidationError, NotFoundError } from './payroll.service';
import { PayrollWorkflowService } from './payroll-workflow.service';
import { PayrollError } from './payroll-workflow';
import type { PayrollContext } from './payroll.repository';
import type {
  PayrollValidationResult, PayrollPeriodWorkflowResult, PayrollPrepareRequest, PayrollSendBackRequest, PayrollApproveRequest, PayrollPayRequest, PayrollPayout, PayrollPayoutRequest,
  PayrollPayoutStatusRequest, PayrollExportRequest, PayrollExportFile, PayrollExportRecord, PayrollTechnicianDetail, PayrollAdjustment, PayrollAdjustmentRequest, PayrollAdjustmentCreated,
  PayrollAdjustmentDecisionRequest, PayrollCarryForwardResult, PayrollExceptionRow, PayrollExceptionActionRequest, PayrollExceptionActionResult, PayrollInquiryView, PayrollInquiryRespondRequest,
  PayrollInquiryRespondResult, PayrollProviderStatus, PayrollPayPlan, PayrollPayPlanRequest, PayrollDeductionType, PayrollDeductionTypeRequest,
} from '@aipowersalon/api-contracts/tenant';
import type { PeriodFilters, PeriodStatus } from './payroll.dto';
import { ListQueries } from '@aipowersalon/database';
import { PayrollControllerListQueries, SuperAdminPayrollControllerListQueries } from './payroll.list-queries';
import {
  PAYROLL_PERIOD_BODY, PAYROLL_REOPEN_BODY, PAYROLL_PREPARE_BODY, PAYROLL_SEND_BACK_BODY, PAYROLL_APPROVE_BODY, PAYROLL_PAY_BODY,
  PAYROLL_PAYOUT_BODY, PAYROLL_PAYOUT_STATUS_BODY, PAYROLL_EXPORT_BODY, PAYROLL_ADJUSTMENT_BODY, PAYROLL_ADJUSTMENT_DECISION_BODY, PAYROLL_EXCEPTION_ACTION_BODY,
  PAYROLL_INQUIRY_RESPOND_BODY, PAY_PLAN_BODY, DEDUCTION_TYPE_BODY,
} from '../request-schemas';

function ctxFrom(req: any): PayrollContext { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? null, userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
function filtersFrom(q: any): PeriodFilters { const n = (v: any) => (v === undefined || v === '' ? undefined : Number(v)); return { status: q.status as PeriodStatus, search: q.search, page: n(q.page), pageSize: n(q.pageSize) }; }
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e instanceof PayrollError) throw new HttpException({ code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) }, e.status);
    if (e instanceof ForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof NotFoundError) throw new HttpException(e.message, HttpStatus.NOT_FOUND);
    // the paid / review line lock at the database (migration 610) — answered as the payroll code, never a SQL error (§205)
    if (e?.code === '23514' && /locked/.test(String(e?.message))) throw new HttpException({ code: 'PAYROLL_PERIOD_LOCKED', message: 'This payroll period has already been locked. Create an adjustment instead of editing historical payroll.' }, HttpStatus.CONFLICT);
    throw e;
  }
}
const intOrNull = (v: any): number | null => (v === undefined || v === null || v === '' ? null : Number(v));

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(PayrollControllerListQueries)
@Controller('pos/payroll')
export class PayrollController {
  constructor(private readonly svc: PayrollService, @Optional() @Inject(PayrollWorkflowService) private readonly wf?: PayrollWorkflowService | null) {}
  private flow(): PayrollWorkflowService {
    if (!this.wf) throw new PayrollError('SERVICE_UNAVAILABLE', 'Payroll approval needs the database.');
    return this.wf;
  }

  @Get('state') @RequirePermission('pos.payroll.view') state(@Req() r: any, @Query() q: any) { return run(() => this.svc.getState(ctxFrom(r), filtersFrom(q))); }
  // the period read — with payouts, paid / outstanding per line (§78) when the workflow is bound
  @Get('periods/:id') @RequirePermission('pos.payroll.view') period(@Req() r: any, @Param('id') id: string) { return run(() => (this.wf ? this.wf.detail(ctxFrom(r), id) : this.svc.getPeriod(ctxFrom(r), id))); }

  @Post('periods') @RequirePermission('pos.payroll.manage') create(@Req() r: any, @Body(ValidatedBody(PAYROLL_PERIOD_BODY)) b: any) { return run(() => this.svc.createPeriod(ctxFrom(r), b)); }
  // POST periods/:id/lines + DELETE periods/:id/lines/:techId (hand-typed manual lines) were REMOVED Oct 13 2026 (FLOW D7):
  // PREPARE writes the canonical lines; off-POS money is an adjustment (POST periods/:id/adjustments).
  @Post('periods/:id/build-from-sales') @RequirePermission('pos.payroll.manage') buildFromSales(@Req() r: any, @Param('id') id: string) { return run(() => this.svc.buildFromSales(ctxFrom(r), id)); }

  // ── wave 2 workflow ───────────────────────────────────────────────────────────────────────────────────────────────
  @Get('periods/:id/validation') @RequirePermission('pos.payroll.view') validation(@Req() r: any, @Param('id') id: string): Promise<PayrollValidationResult> { return run(() => this.flow().validate(ctxFrom(r), id)); }
  @Post('periods/:id/prepare') @RequirePermission('pos.payroll.manage') prepare(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_PREPARE_BODY)) b: PayrollPrepareRequest): Promise<PayrollPeriodWorkflowResult> { return run(() => this.flow().prepare(ctxFrom(r), id, { expectedVersion: intOrNull(b?.expectedVersion) })); }
  @Post('periods/:id/send-back') @RequirePermission('pos.payroll.manage') sendBack(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_SEND_BACK_BODY)) b: PayrollSendBackRequest): Promise<PayrollPeriodWorkflowResult> { return run(() => this.flow().sendBack(ctxFrom(r), id, { reason: b?.reason, expectedVersion: intOrNull(b?.expectedVersion) })); }
  // §71–§72 approve = finalize (the route name the clients already call)
  @Post('periods/:id/finalize') @RequirePermission('payroll.approve') @RequireStepUp() finalize(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_APPROVE_BODY)) b: PayrollApproveRequest): Promise<PayrollPeriodWorkflowResult> { return run(() => this.flow().approve(ctxFrom(r), id, { expectedVersion: intOrNull(b?.expectedVersion), calculationHash: b?.calculationHash ?? null })); }
  @Post('periods/:id/pay') @RequirePermission('payouts.manage') @RequireStepUp() pay(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_PAY_BODY)) b: PayrollPayRequest): Promise<PayrollPeriodWorkflowResult> { return run(() => this.flow().markPaid(ctxFrom(r), id, { expectedVersion: intOrNull(b?.expectedVersion), method: b?.method, reference: b?.reference })); }
  @Post('periods/:id/reopen') @RequirePermission('payroll.approve') @RequireStepUp() reopen(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_REOPEN_BODY)) b: PayrollSendBackRequest): Promise<PayrollPeriodWorkflowResult> { return run(() => this.flow().reopen(ctxFrom(r), id, { reason: b?.reason, expectedVersion: intOrNull(b?.expectedVersion) })); }
  @Get('periods/:id/payouts') @RequirePermission('pos.payroll.view') payouts(@Req() r: any, @Param('id') id: string): Promise<PayrollPayout[]> { return run(() => this.flow().payouts(ctxFrom(r), id)); }
  @Post('periods/:id/payouts') @RequirePermission('payouts.manage') @RequireStepUp() recordPayout(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_PAYOUT_BODY)) b: PayrollPayoutRequest): Promise<PayrollPayout> { return run(() => this.flow().recordPayout(ctxFrom(r), id, b)); }
  @Post('payouts/:payoutId/status') @RequirePermission('payouts.manage') @RequireStepUp() payoutStatus(@Req() r: any, @Param('payoutId') payoutId: string, @Body(ValidatedBody(PAYROLL_PAYOUT_STATUS_BODY)) b: PayrollPayoutStatusRequest): Promise<PayrollPayout> { return run(() => this.flow().setPayoutStatus(ctxFrom(r), payoutId, b)); }
  @Post('periods/:id/export') @RequirePermission('payroll.export') exportPeriod(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_EXPORT_BODY)) b: PayrollExportRequest): Promise<PayrollExportFile> { return run(() => this.flow().exportPeriod(ctxFrom(r), id, b?.format)); }
  @Get('periods/:id/exports') @RequirePermission('pos.payroll.view') exportHistory(@Req() r: any, @Param('id') id: string): Promise<PayrollExportRecord[]> { return run(() => this.flow().exportHistory(ctxFrom(r), id)); }
  @Get('periods/:id/technicians/:techId') @RequirePermission('pos.payroll.view') technician(@Req() r: any, @Param('id') id: string, @Param('techId') techId: string): Promise<PayrollTechnicianDetail> { return run(() => this.flow().technicianDetail(ctxFrom(r), id, techId)); }
  @Post('periods/:id/adjustments') @RequirePermission('payroll.adjust') createAdjustment(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(PAYROLL_ADJUSTMENT_BODY)) b: PayrollAdjustmentRequest): Promise<PayrollAdjustmentCreated> { return run(() => this.flow().createAdjustment(ctxFrom(r), id, b)); }
  @Post('periods/:id/technicians/:techId/carry-forward') @RequirePermission('payroll.adjust') carryForward(@Req() r: any, @Param('id') id: string, @Param('techId') techId: string): Promise<PayrollCarryForwardResult> { return run(() => this.flow().carryForward(ctxFrom(r), id, techId)); }
  @Get('adjustments') @RequirePermission('pos.payroll.view') adjustments(@Req() r: any, @Query() q: any): Promise<PayrollAdjustment[]> { return run(() => this.flow().listAdjustments(ctxFrom(r), { status: q?.status || undefined, periodId: q?.periodId || undefined })); }
  @Post('adjustments/:adjId/decide') @RequirePermission('payroll.approve') @RequireStepUp() decideAdjustment(@Req() r: any, @Param('adjId') adjId: string, @Body(ValidatedBody(PAYROLL_ADJUSTMENT_DECISION_BODY)) b: PayrollAdjustmentDecisionRequest): Promise<PayrollAdjustment> { return run(() => this.flow().decideAdjustment(ctxFrom(r), adjId, b)); }
  @Get('exceptions') @RequirePermission('pos.payroll.view') exceptions(@Req() r: any, @Query() q: any): Promise<PayrollExceptionRow[]> { return run(() => this.flow().listExceptions(ctxFrom(r), { status: q?.status || undefined, kind: q?.kind || undefined })); }
  @Post('exceptions/:exId/action') @RequirePermission('pos.payroll.manage') exceptionAction(@Req() r: any, @Param('exId') exId: string, @Body(ValidatedBody(PAYROLL_EXCEPTION_ACTION_BODY)) b: PayrollExceptionActionRequest): Promise<PayrollExceptionActionResult> { return run(() => this.flow().actOnException(ctxFrom(r), exId, b)); }
  @Get('inquiries') @RequirePermission('pos.payroll.view') inquiries(@Req() r: any, @Query() q: any): Promise<PayrollInquiryView[]> { return run(() => this.flow().listInquiries(ctxFrom(r), { status: q?.status || undefined })); }
  @Post('inquiries/:inqId/respond') @RequirePermission('pos.payroll.manage') respondInquiry(@Req() r: any, @Param('inqId') inqId: string, @Body(ValidatedBody(PAYROLL_INQUIRY_RESPOND_BODY)) b: PayrollInquiryRespondRequest): Promise<PayrollInquiryRespondResult> { return run(() => this.flow().respondInquiry(ctxFrom(r), inqId, b)); }
  @Get('provider') @RequirePermission('pos.payroll.view') provider(@Req() r: any): Promise<PayrollProviderStatus> { return run(() => this.flow().providerStatus(ctxFrom(r))); }
  // §38–§45 pay plans + §59–§61 deduction types — the owner's compensation keys; a rate change moves money → step-up
  @Get('pay-plans') @RequirePermission('compensation.view_all') listPayPlans(@Req() r: any, @Query() q: any): Promise<PayrollPayPlan[]> { return run(() => this.flow().listPayPlans(ctxFrom(r), q?.technicianId || undefined)); }
  @Post('pay-plans') @RequirePermission('compensation.manage') @RequireStepUp() createPayPlan(@Req() r: any, @Body(ValidatedBody(PAY_PLAN_BODY)) b: PayrollPayPlanRequest): Promise<PayrollPayPlan> { return run(() => this.flow().createPayPlan(ctxFrom(r), b)); }
  @Post('pay-plans/:planId/archive') @RequirePermission('compensation.manage') @RequireStepUp() archivePayPlan(@Req() r: any, @Param('planId') planId: string): Promise<PayrollPayPlan> { return run(() => this.flow().archivePayPlan(ctxFrom(r), planId)); }
  @Get('deduction-types') @RequirePermission('pos.payroll.view') deductionTypes(@Req() r: any): Promise<PayrollDeductionType[]> { return run(() => this.flow().listDeductionTypes(ctxFrom(r))); }
  @Post('deduction-types') @RequirePermission('compensation.manage') upsertDeductionType(@Req() r: any, @Body(ValidatedBody(DEDUCTION_TYPE_BODY)) b: PayrollDeductionTypeRequest): Promise<PayrollDeductionType> { return run(() => this.flow().upsertDeductionType(ctxFrom(r), b)); }
}

@UseGuards(SuperAdminGuard)
@ListQueries(SuperAdminPayrollControllerListQueries)
@Controller('super-admin/payroll')
export class SuperAdminPayrollController {
  constructor(private readonly svc: PayrollService, @Optional() @Inject(PayrollWorkflowService) private readonly wf?: PayrollWorkflowService | null) {}

  // §166: platform-safe status only — period statuses, counts, exception counts; no technician, no money. Tenant-private
  // payroll stays behind the salon's own permission (Support Mode reads go through the support-session guard, §167).
  @Get('state') state(@Query() q: any) {
    return run(async () => {
      const s = await this.svc.getPlatformState({ ...filtersFrom(q), tenantId: q.tenantId || undefined });
      const strip = (p: any) => ({ id: p.id, tenantId: p.tenantId, branchId: p.branchId, label: p.label, periodStart: p.periodStart, periodEnd: p.periodEnd, status: p.status, dashboardStatus: p.dashboardStatus ?? null, blockingCount: p.blockingCount ?? 0 });
      return { kpis: { totalPeriods: s.kpis.totalPeriods, openPeriods: s.kpis.openPeriods }, periods: s.periods.map(strip), pagination: s.pagination, platform: this.wf ? await this.wf.platformStatus() : null };
    });
  }
}
