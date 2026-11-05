// deposit-reconciliation.controller.ts — tenant AI Deposit Reconciliation. Route: pos/deposit-reconciliation.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch are server-derived from req.ctx — NEVER the body.
// Reads require reconciliation.view; writes require reconciliation.manage.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Query, Req, Header, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DepositReconciliationService, ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';
import { FeeReconciliationService } from './deposit-reconciliation.fees.service';
import { AdjustmentsReconciliationService } from './deposit-reconciliation.adjustments.service';
import { DuplicateDetectionService } from './deposit-reconciliation.duplicates.service';
import { ExceptionWorkflowService } from './deposit-reconciliation.exceptions.service';
import { AiExplanationService } from './deposit-reconciliation.explain.service';
import { ReportsService } from './deposit-reconciliation.reports.service';
import { PeriodsService } from './deposit-reconciliation.periods.service';
import { ReconSweepService } from './deposit-reconciliation.sweep.service';
import type { ReconContext } from './deposit-reconciliation.dto';
import { ListQueries } from '@aipowersalon/database';
import { DepositReconciliationControllerListQueries } from './deposit-reconciliation.list-queries';

import { BANK_ACCOUNT_BODY, DEPOSIT_BODY, DEPOSIT_LINK_BODY, FEE_SCHEDULE_BODY, RECON_ASSIGN_BODY, RECON_EXCEPTION_BODY, RECON_NOTE_BODY, RECON_PERIOD_BODY, RECON_PERIOD_CLOSE_BODY, RECON_TRANSITION_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
function ctxFrom(req: any): ReconContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] };
}
async function run<T>(fn: () => T | Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ReconForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof ReconValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(DepositReconciliationControllerListQueries)
@Controller('pos/deposit-reconciliation')
export class DepositReconciliationController {
  constructor(private readonly svc: DepositReconciliationService, private readonly fees: FeeReconciliationService, private readonly adjustments: AdjustmentsReconciliationService, private readonly duplicates: DuplicateDetectionService, private readonly exceptions: ExceptionWorkflowService, private readonly explain: AiExplanationService, private readonly reports: ReportsService, private readonly periods: PeriodsService, private readonly sweep: ReconSweepService) {}

  @Get('state') @RequirePermission('reconciliation.view')
  state(@Req() r: any) { return run(() => this.svc.getState(ctxFrom(r))); }

  @Get('bank-accounts') @RequirePermission('reconciliation.view')
  banks(@Req() r: any) { return run(() => this.svc.listBankAccounts(ctxFrom(r))); }

  @Post('bank-accounts') @RequirePermission('reconciliation.manage')
  createBank(@Req() r: any, @Body(ValidatedBody(BANK_ACCOUNT_BODY)) b: any) { return run(() => this.svc.createBankAccount(ctxFrom(r), { nickname: b?.nickname, bankName: b?.bankName, accountType: b?.accountType, accountLast4: b?.accountLast4, currency: b?.currency })); }

  @Get('deposits') @RequirePermission('reconciliation.view')
  deposits(@Req() r: any) { return run(() => this.svc.listDeposits(ctxFrom(r))); }

  @Post('deposits') @RequirePermission('reconciliation.manage')
  createDeposit(@Req() r: any, @Body(ValidatedBody(DEPOSIT_BODY)) b: any) { return run(() => this.svc.createDeposit(ctxFrom(r), { bankAccountId: b?.bankAccountId, branchId: b?.branchId ?? null, amountCents: b?.amountCents, currency: b?.currency, depositDate: b?.depositDate ?? null, description: b?.description ?? null, reference: b?.reference ?? null, externalBankTxnId: b?.externalBankTxnId ?? null, source: b?.source })); }

  @Post('deposits/:id/link') @RequirePermission('reconciliation.manage')
  link(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(DEPOSIT_LINK_BODY)) b: any) { return run(() => this.svc.linkDeposit(ctxFrom(r), id, b?.settlementId ?? null)); }

  // ---- fee reconciliation ----
  @Get('fee-schedules') @RequirePermission('reconciliation.view')
  feeSchedules(@Req() r: any) { return run(() => this.fees.listFeeSchedules(ctxFrom(r))); }

  @Post('fee-schedules') @RequirePermission('reconciliation.manage')
  createFeeSchedule(@Req() r: any, @Body(ValidatedBody(FEE_SCHEDULE_BODY)) b: any) { return run(() => this.fees.createFeeSchedule(ctxFrom(r), { processorType: b?.processorType, label: b?.label, effectiveFrom: b?.effectiveFrom, percentageBps: b?.percentageBps, perTransactionCents: b?.perTransactionCents, batchCents: b?.batchCents, monthlyCents: b?.monthlyCents, notes: b?.notes ?? null })); }

  @Get('fee-reconciliation') @RequirePermission('reconciliation.view')
  feeReconciliation(@Req() r: any) { return run(() => this.fees.getFeeReconciliation(ctxFrom(r))); }

  // ---- refunds / chargebacks / adjustments (read-only reconciliation view over existing systems) ----
  @Get('adjustments') @RequirePermission('reconciliation.view')
  adjustmentsView(@Req() r: any) { return run(() => this.adjustments.getState(ctxFrom(r))); }

  // ---- duplicate detection (settlements + deposits) ----
  @Get('duplicates') @RequirePermission('reconciliation.view')
  duplicatesView(@Req() r: any) { return run(() => this.duplicates.getState(ctxFrom(r))); }

  // ---- exception queue + human review/approval workflow ----
  @Get('exceptions') @RequirePermission('reconciliation.view')
  exceptionsList(@Req() r: any, @Query('status') status?: string) { return run(() => this.exceptions.getState(ctxFrom(r), status)); }

  @Post('exceptions') @RequirePermission('reconciliation.manage')
  createException(@Req() r: any, @Body(ValidatedBody(RECON_EXCEPTION_BODY)) b: any) { return run(() => this.exceptions.create(ctxFrom(r), { kind: b?.kind, severity: b?.severity, title: b?.title, detail: b?.detail ?? null, amountCents: b?.amountCents, currency: b?.currency, sourceRef: b?.sourceRef ?? null, branchId: b?.branchId ?? null })); }

  @Post('exceptions/:id/assign') @RequirePermission('reconciliation.manage')
  assignException(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECON_ASSIGN_BODY)) b: any) { return run(() => this.exceptions.assign(ctxFrom(r), id, b?.assigneeUserId ?? null)); }

  @Post('exceptions/:id/transition') @RequirePermission('reconciliation.manage')
  transitionException(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECON_TRANSITION_BODY)) b: any) { return run(() => this.exceptions.transition(ctxFrom(r), id, b?.status)); }

  // Closure requires the approve permission AND a note (evidence) — enforced in the service.
  @Post('exceptions/:id/resolve') @RequirePermission('reconciliation.approve')
  resolveException(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECON_NOTE_BODY)) b: any) { return run(() => this.exceptions.resolve(ctxFrom(r), id, b?.note)); }

  @Post('exceptions/:id/reopen') @RequirePermission('reconciliation.manage')
  reopenException(@Req() r: any, @Param('id') id: string) { return run(() => this.exceptions.reopen(ctxFrom(r), id)); }

  // ---- AI explanation (explainer only; deterministic facts are the source of truth; never resolves) ----
  @Post('explain/settlement/:id') @RequirePermission('reconciliation.view')
  explainSettlement(@Req() r: any, @Param('id') id: string) { return run(() => this.explain.explainSettlement(ctxFrom(r), id)); }

  // ---- finance reports + exports ----
  @Get('reports/daily') @RequirePermission('reconciliation.view')
  reportDaily(@Req() r: any) { return run(() => this.reports.getDaily(ctxFrom(r))); }

  @Get('reports/summary') @RequirePermission('reconciliation.view')
  reportSummary(@Req() r: any) { return run(() => this.reports.getSummary(ctxFrom(r))); }

  @AsyncExport({ kind: 'pos.deposit-reconciliation.daily-export' }) @Get('reports/daily/export') @RequirePermission('reconciliation.view') @Header('Content-Type', 'text/csv') @Header('Content-Disposition', 'attachment; filename="daily-reconciliation.csv"')
  reportDailyExport(@Req() r: any) { return run(() => this.reports.exportDailyCsv(ctxFrom(r))); }

  // ---- accounting-period close ----
  @Get('periods') @RequirePermission('reconciliation.view')
  periodsList(@Req() r: any) { return run(() => this.periods.list(ctxFrom(r))); }

  @Post('periods') @RequirePermission('reconciliation.manage')
  createPeriod(@Req() r: any, @Body(ValidatedBody(RECON_PERIOD_BODY)) b: any) { return run(() => this.periods.create(ctxFrom(r), { label: b?.label, periodStart: b?.periodStart, periodEnd: b?.periodEnd, notes: b?.notes ?? null })); }

  @Get('periods/:id/check-close') @RequirePermission('reconciliation.view')
  checkClose(@Req() r: any, @Param('id') id: string) { return run(() => this.periods.checkClose(ctxFrom(r), id)); }

  // Closing a period is a significant control -> approve permission (and the guard blocks material differences).
  @Post('periods/:id/close') @RequirePermission('reconciliation.approve')
  closePeriod(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECON_PERIOD_CLOSE_BODY)) b: any) { return run(() => this.periods.close(ctxFrom(r), id, b?.notes ?? null)); }

  @Post('periods/:id/reopen') @RequirePermission('reconciliation.manage')
  reopenPeriod(@Req() r: any, @Param('id') id: string) { return run(() => this.periods.reopen(ctxFrom(r), id)); }

  // Manually re-scan THIS tenant: runs the deterministic engine and opens exceptions for any new missing deposits
  // or fee differences (idempotent — never duplicates an unresolved case, never resolves). Same job the scheduler runs.
  @Post('rescan') @RequirePermission('reconciliation.manage')
  rescan(@Req() r: any) { return run(async () => ({ exceptionsCreated: await this.sweep.sweepTenant(ctxFrom(r)) })); }
}
