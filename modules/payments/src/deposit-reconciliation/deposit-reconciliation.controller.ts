// deposit-reconciliation.controller.ts — tenant AI Deposit Reconciliation. Route: pos/deposit-reconciliation.
// Guards: TenantAuthGuard + RolePermissionGuard. Tenant/branch are server-derived from req.ctx — NEVER the body.
// Reads require reconciliation.view; writes require reconciliation.manage.
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { Controller, Get, Post, Body, Param, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { DepositReconciliationService, ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';
import { FeeReconciliationService } from './deposit-reconciliation.fees.service';
import { AdjustmentsReconciliationService } from './deposit-reconciliation.adjustments.service';
import { DuplicateDetectionService } from './deposit-reconciliation.duplicates.service';
import { ExceptionWorkflowService } from './deposit-reconciliation.exceptions.service';
import { AiExplanationService } from './deposit-reconciliation.explain.service';
import { PeriodsService } from './deposit-reconciliation.periods.service';
import { ReconSweepService } from './deposit-reconciliation.sweep.service';
import type { ReconContext } from './deposit-reconciliation.dto';
import { ListQueries } from '@aipowersalon/database';
import { DepositReconciliationControllerListQueries } from './deposit-reconciliation.list-queries';

import { FEE_SCHEDULE_BODY, RECON_EXCEPTION_BODY, RECON_PERIOD_BODY, RECON_PERIOD_CLOSE_BODY, RECON_TRANSITION_BODY } from '../request-schemas';   // BUILD_PLAN Phase 12 (#17)
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
  constructor(private readonly svc: DepositReconciliationService, private readonly fees: FeeReconciliationService, private readonly adjustments: AdjustmentsReconciliationService, private readonly duplicates: DuplicateDetectionService, private readonly exceptions: ExceptionWorkflowService, private readonly explain: AiExplanationService, private readonly periods: PeriodsService, private readonly sweep: ReconSweepService) {}

  // Oct 29 2026 (AI Deposit Reconciliation one-screen rebuild): the page's state, bank accounts, deposits, links, fee
  // reconciliation, exception list / assign / resolve and the daily / summary reports moved to the workspace routes
  // (pos/deposit-reconciliation/workspace/*, recon-workspace.controller.ts) — one matching model (allocations), one
  // bank-account writer (owner, step-up). The superseded routes here had no caller left and were removed.

  // ---- fee reconciliation ----
  @Get('fee-schedules') @RequirePermission('reconciliation.view')
  feeSchedules(@Req() r: any) { return run(() => this.fees.listFeeSchedules(ctxFrom(r))); }

  @Post('fee-schedules') @RequirePermission('reconciliation.manage')
  createFeeSchedule(@Req() r: any, @Body(ValidatedBody(FEE_SCHEDULE_BODY, { strict: true })) b: any) { return run(() => this.fees.createFeeSchedule(ctxFrom(r), { processorType: b?.processorType, label: b?.label, effectiveFrom: b?.effectiveFrom, percentageBps: b?.percentageBps, perTransactionCents: b?.perTransactionCents, batchCents: b?.batchCents, monthlyCents: b?.monthlyCents, notes: b?.notes ?? null })); }

  // ---- refunds / chargebacks / adjustments (read-only reconciliation view over existing systems) ----
  @Get('adjustments') @RequirePermission('reconciliation.view')
  adjustmentsView(@Req() r: any) { return run(() => this.adjustments.getState(ctxFrom(r))); }

  // ---- duplicate detection (settlements + deposits) ----
  @Get('duplicates') @RequirePermission('reconciliation.view')
  duplicatesView(@Req() r: any) { return run(() => this.duplicates.getState(ctxFrom(r))); }

  // ---- exception queue + human review/approval workflow ----
  @Post('exceptions') @RequirePermission('reconciliation.manage')
  createException(@Req() r: any, @Body(ValidatedBody(RECON_EXCEPTION_BODY, { strict: true })) b: any) { return run(() => this.exceptions.create(ctxFrom(r), { kind: b?.kind, severity: b?.severity, title: b?.title, detail: b?.detail ?? null, amountCents: b?.amountCents, currency: b?.currency, sourceRef: b?.sourceRef ?? null, branchId: b?.branchId ?? null })); }

  @Post('exceptions/:id/transition') @RequirePermission('reconciliation.manage')
  transitionException(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECON_TRANSITION_BODY, { strict: true })) b: any) { return run(() => this.exceptions.transition(ctxFrom(r), id, b?.status)); }

  @Post('exceptions/:id/reopen') @RequirePermission('reconciliation.manage')
  reopenException(@Req() r: any, @Param('id') id: string) { return run(() => this.exceptions.reopen(ctxFrom(r), id)); }

  // ---- AI explanation (explainer only; deterministic facts are the source of truth; never resolves) ----
  @Post('explain/settlement/:id') @RequirePermission('reconciliation.view')
  explainSettlement(@Req() r: any, @Param('id') id: string) { return run(() => this.explain.explainSettlement(ctxFrom(r), id)); }

  // ---- accounting-period close ----
  @Get('periods') @RequirePermission('reconciliation.view')
  periodsList(@Req() r: any) { return run(() => this.periods.list(ctxFrom(r))); }

  @Post('periods') @RequirePermission('reconciliation.manage')
  createPeriod(@Req() r: any, @Body(ValidatedBody(RECON_PERIOD_BODY, { strict: true })) b: any) { return run(() => this.periods.create(ctxFrom(r), { label: b?.label, periodStart: b?.periodStart, periodEnd: b?.periodEnd, notes: b?.notes ?? null })); }

  @Get('periods/:id/check-close') @RequirePermission('reconciliation.view')
  checkClose(@Req() r: any, @Param('id') id: string) { return run(() => this.periods.checkClose(ctxFrom(r), id)); }

  // Closing a period is a significant control -> approve permission (and the guard blocks material differences).
  @Post('periods/:id/close') @RequirePermission('reconciliation.approve')
  closePeriod(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(RECON_PERIOD_CLOSE_BODY, { strict: true })) b: any) { return run(() => this.periods.close(ctxFrom(r), id, b?.notes ?? null)); }

  @Post('periods/:id/reopen') @RequirePermission('reconciliation.manage')
  reopenPeriod(@Req() r: any, @Param('id') id: string) { return run(() => this.periods.reopen(ctxFrom(r), id)); }

  // Manually re-scan THIS tenant: runs the deterministic engine and opens exceptions for any new missing deposits
  // or fee differences (idempotent — never duplicates an unresolved case, never resolves). Same job the scheduler runs.
  @Post('rescan') @RequirePermission('reconciliation.manage')
  rescan(@Req() r: any) { return run(async () => ({ exceptionsCreated: await this.sweep.sweepTenant(ctxFrom(r)) })); }
}
