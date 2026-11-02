// recon-workspace.controller.ts — AI Deposit Reconciliation mandate (Oct 29 2026): `/pos/deposit-reconciliation/workspace/*`,
// the server side of the rebuilt POS page (Overview · Fees · Exceptions · Reports). The older routes of
// deposit-reconciliation.controller.ts stay for their callers; matching now goes through allocations here.
// Guards: TenantAuthGuard + RolePermissionGuard; tenant / role from the session. Least privilege:
//   reconciliation.view     every read, the reports and their CSV / PDF exports (audited)
//   reconciliation.manage   Record a Deposit · match (allocate) · notes · Investigate (raise a case) · assign · mark under review
//   reconciliation.approve  unmatch · resolve a case · a partial-on-both-sides match · bank account administration (+ step-up)
// Nothing here moves money or changes a payout destination (spec §18 high-risk constraints).
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireStepUp, AsyncExport, ValidatedBody } from '@aipowersalon/permissions/guards';
import { hasPermission } from '@aipowersalon/permissions';
import { Controller, Get, Post, Body, Param, Query, Req, Res, Header, UseGuards, HttpException, HttpStatus, Inject, Optional } from '@nestjs/common';
import { ReconWorkspaceRepository, REPORT_TYPES, EXCEPTION_CLASSES, type ReportType, type ExceptionClass } from './recon-workspace.repository';
import { ExceptionWorkflowService } from '../deposit-reconciliation/deposit-reconciliation.exceptions.service';
import { FinanceError, pageReq, oneOf, type FinanceCtx } from './finance-scope';
import { financeCtx, needPermission, runFinance } from './settlements-screen.controller';
import { renderReportPdf, money } from './finance-pdf';
import {
  RECON_ALLOCATION_BODY, RECON_UNMATCH_BODY, RECON_BANK_ACCOUNT_BODY, RECON_BANK_ACCOUNT_UPDATE_BODY, RECON_DEPOSIT_BODY, RECON_WORKSPACE_NOTE_BODY,
  RECON_RAISE_BODY, RECON_WORKSPACE_ASSIGN_BODY, RECON_RESOLVE_BODY,
} from '../request-schemas';

export const RECON_WORKSPACE_REPOSITORY = 'ReconWorkspaceRepository';
const can = (c: FinanceCtx, p: string) => hasPermission(c as Parameters<typeof hasPermission>[0], p);
const RAISE_KINDS = ['missing_deposit', 'amount_mismatch', 'duplicate', 'unmatched_deposit', 'fee_difference', 'integration_error'] as const;

const SCOPE_FILTERS = {
  preset: { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom'] },
  dateField: { type: 'enum', values: ['settlement', 'expected_deposit', 'bank_posted', 'payment', 'created'] },
  status: { type: 'enum', values: ['pending', 'expected', 'matched', 'partially_matched', 'overdue', 'exception', 'under_review', 'no_payout', 'all'] },
  processor: { type: 'text', maxLength: 40 }, bankAccountId: { type: 'text', maxLength: 64 }, open: { type: 'enum', values: ['0', '1', 'true', 'false'] },
} as const;
const SCOPE_LIST = {
  filters: SCOPE_FILTERS, sorts: { created_desc: null, created_asc: null, settled_desc: null, arrival_asc: null, difference_desc: null, expected_desc: null },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const FEES_LIST = { ...SCOPE_LIST, filters: { ...SCOPE_FILTERS, feeCategory: { type: 'enum', values: ['all', 'deducted', 'zero_fee', 'adjusted', 'components'] } } } as const;
const EXC_LIST = {
  filters: { ...SCOPE_FILTERS, status: { type: 'enum', values: ['open', 'in_review', 'escalated', 'resolved', 'reopened', 'active', 'all'] },
    severity: { type: 'enum', values: ['info', 'low', 'moderate', 'high', 'critical', 'all'] }, class: { type: 'enum', values: ['missing', 'amount_mismatch', 'duplicate', 'unmatched_credit', 'fee_reversal', 'integration', 'all'] } },
  search: { params: ['search'], maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'],
} as const;
const SEARCH_ONLY = { search: { params: ['search'], maxLength: 100 } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/deposit-reconciliation/workspace')
export class ReconWorkspaceController {
  constructor(@Inject(RECON_WORKSPACE_REPOSITORY) private readonly repo: ReconWorkspaceRepository | null, @Optional() private readonly exceptionsSvc?: ExceptionWorkflowService) {}
  private r(): ReconWorkspaceRepository { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Reconciliation needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private x(): ExceptionWorkflowService { if (!this.exceptionsSvc) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Reconciliation needs the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.exceptionsSvc; }
  private async scope(c: FinanceCtx, q: Record<string, unknown>) { const period = await this.r().period(c, q); return this.r().filters(period, q); }

  // ── overview ──
  @Get('kpis') @RequirePermission('reconciliation.view') @ListQuery(SCOPE_LIST)
  kpis(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string, @Query('search') search?: string,
    @Query('processor') processor?: string, @Query('bankAccountId') bankAccountId?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const f = await this.scope(c, { preset, from, to, dateField, search, processor, bankAccountId });
      const [kpis, accounts] = await Promise.all([this.r().kpis(c, f), this.r().bankAccounts(c)]);
      return { period: f.period, dateBasis: f.basis, kpis, bankConfigured: accounts.length > 0, dataAsOf: new Date().toISOString(),
        permissions: { manage: can(c, 'reconciliation.manage'), approve: can(c, 'reconciliation.approve') } };
    });
  }
  @Get('settlements') @RequirePermission('reconciliation.view') @ListQuery(SCOPE_LIST)
  settlements(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string, @Query('search') search?: string,
    @Query('status') status?: string, @Query('processor') processor?: string, @Query('bankAccountId') bankAccountId?: string, @Query('sort') sort?: string, @Query('open') open?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const f = await this.scope(c, { preset, from, to, dateField, search, status, processor, bankAccountId, sort, open });
      return { ...(await this.r().listSettlements(c, f, pageReq({ page, pageSize }))), period: f.period, dateBasis: f.basis };
    });
  }
  @Get('settlements/:settlementId') @RequirePermission('reconciliation.view')
  settlement(@Req() req: any, @Param('settlementId') id: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => { const p = await this.r().period(c, {}); const d = await this.r().settlementDetail(c, id, p.tz); if (!d) throw new FinanceError('That settlement could not be found.', 'SETTLEMENT_NOT_FOUND', 404); return d; });
  }
  @Get('deposits') @RequirePermission('reconciliation.view') @ListQuery({ ...SCOPE_LIST, filters: { ...SCOPE_FILTERS, unmatched: { type: 'enum', values: ['0', '1'] } } })
  deposits(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string, @Query('bankAccountId') bankAccountId?: string,
    @Query('unmatched') unmatched?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const f = await this.scope(c, { preset, from, to, search, bankAccountId });
      return { ...(await this.r().listDeposits(c, f, pageReq({ page, pageSize }), { unmatchedOnly: unmatched !== '0' })), period: f.period };
    });
  }
  @Get('deposits/:depositId') @RequirePermission('reconciliation.view')
  deposit(@Req() req: any, @Param('depositId') id: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => { const d = await this.r().depositDetail(c, id); if (!d) throw new FinanceError('That bank deposit could not be found.', 'BANK_DEPOSIT_NOT_FOUND', 404); return d; });
  }
  @Get('deposits/:depositId/suggestions') @RequirePermission('reconciliation.view')
  suggestions(@Req() req: any, @Param('depositId') id: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => { const p = await this.r().period(c, {}); const d = await this.r().suggestions(c, id, p.tz); if (!d) throw new FinanceError('That bank deposit could not be found.', 'BANK_DEPOSIT_NOT_FOUND', 404); return d; });
  }
  @Get('search') @RequirePermission('reconciliation.view') @ListQuery(SEARCH_ONLY)
  search(@Req() req: any, @Query('search') search?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => { const p = await this.r().period(c, {}); return this.r().universalSearch(c, String(search ?? ''), p.tz); });
  }

  // ── matching ──
  @Post('allocations') @RequirePermission('reconciliation.manage')
  allocate(@Req() req: any, @Body(ValidatedBody(RECON_ALLOCATION_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(() => this.r().allocate(c, { settlementId: String(b?.settlementId ?? ''), depositId: String(b?.depositId ?? ''), amountCents: b?.amountCents, reviewed: b?.reviewed === true,
      note: b?.note ?? null, idempotencyKey: String(b?.idempotencyKey ?? ''), basis: b?.basis ?? null, canApprove: can(c, 'reconciliation.approve') }));
  }
  @Post('allocations/:allocationId/unmatch') @RequirePermission('reconciliation.approve')
  unmatch(@Req() req: any, @Param('allocationId') id: string, @Body(ValidatedBody(RECON_UNMATCH_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.approve');
    return runFinance(() => this.r().unmatch(c, id, String(b?.reason ?? '')));
  }

  // ── bank accounts ──
  @Get('bank-accounts') @RequirePermission('reconciliation.view')
  bankAccounts(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'reconciliation.view'); return runFinance(async () => ({ items: await this.r().bankAccounts(c), canManage: can(c, 'reconciliation.approve') })); }
  @RequireStepUp() @Post('bank-accounts') @RequirePermission('reconciliation.approve')
  addBankAccount(@Req() req: any, @Body(ValidatedBody(RECON_BANK_ACCOUNT_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.approve');
    return runFinance(() => this.r().createBankAccount(c, { nickname: b?.nickname, bankName: b?.bankName, accountType: b?.accountType, accountLast4: b?.accountLast4 }));
  }
  @RequireStepUp() @Post('bank-accounts/:bankAccountId') @RequirePermission('reconciliation.approve')
  updateBankAccount(@Req() req: any, @Param('bankAccountId') id: string, @Body(ValidatedBody(RECON_BANK_ACCOUNT_UPDATE_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.approve');
    return runFinance(() => this.r().updateBankAccount(c, id, { nickname: b?.nickname ?? undefined, makeDefault: b?.makeDefault === true, deactivate: b?.deactivate === true }));
  }

  // ── record a deposit / notes ──
  @Post('deposits') @RequirePermission('reconciliation.manage')
  recordDeposit(@Req() req: any, @Body(ValidatedBody(RECON_DEPOSIT_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(async () => { const p = await this.r().period(c, {}); return this.r().createDeposit(c, b ?? {}, p.today); });
  }
  @Post('notes') @RequirePermission('reconciliation.manage')
  note(@Req() req: any, @Body(ValidatedBody(RECON_WORKSPACE_NOTE_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(() => { const t = oneOf(b?.targetType, ['settlement', 'deposit', 'exception'] as const, 'targetType'); if (!t) throw new FinanceError('Some fields are invalid.', 'VALIDATION_FAILED', 400, { field: 'targetType' }); return this.r().addNote(c, t, String(b?.targetId ?? ''), b?.body); });
  }

  // ── fees ──
  @Get('fees') @RequirePermission('reconciliation.view') @ListQuery(FEES_LIST)
  fees(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string, @Query('processor') processor?: string,
    @Query('feeCategory') feeCategory?: string, @Query('sort') sort?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const f = await this.scope(c, { preset, from, to, search, processor, sort });
      const cat = oneOf(feeCategory, ['deducted', 'zero_fee', 'adjusted', 'components'] as const, 'feeCategory');
      return { ...(await this.r().fees(c, f, pageReq({ page, pageSize }), cat)), period: f.period, dateBasis: 'settlement' };
    });
  }

  // ── exceptions ──
  @Get('exceptions') @RequirePermission('reconciliation.view') @ListQuery(EXC_LIST)
  exceptions(@Req() req: any, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string,
    @Query('status') status?: string, @Query('severity') severity?: string, @Query('class') cls?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const f = await this.scope(c, { preset, from, to, search });
      const st = oneOf(status, ['open', 'in_review', 'escalated', 'resolved', 'reopened', 'active'] as const, 'status');
      const sev = oneOf(severity, ['info', 'low', 'moderate', 'high', 'critical'] as const, 'severity');
      const cl = oneOf(cls, EXCEPTION_CLASSES, 'class') as ExceptionClass | undefined;
      return { ...(await this.r().exceptions(c, f, pageReq({ page, pageSize }), { status: st, severity: sev, cls: cl })), period: f.period, dateBasis: 'created' };
    });
  }
  @Get('exceptions/:exceptionId') @RequirePermission('reconciliation.view')
  exception(@Req() req: any, @Param('exceptionId') id: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => { const d = await this.r().exceptionDetail(c, id); if (!d) throw new FinanceError('That reconciliation case could not be found.', 'RECON_CASE_NOT_FOUND', 404); return d; });
  }
  @Get('reviewers') @RequirePermission('reconciliation.view')
  reviewers(@Req() req: any) { const c = financeCtx(req); needPermission(c, 'reconciliation.view'); return runFinance(async () => ({ items: await this.r().reviewers(c) })); }
  @Post('exceptions') @RequirePermission('reconciliation.manage')
  raise(@Req() req: any, @Body(ValidatedBody(RECON_RAISE_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(async () => {
      const t = oneOf(b?.targetType, ['settlement', 'deposit'] as const, 'targetType'); const kind = oneOf(b?.kind, RAISE_KINDS, 'kind');
      if (!t || !kind) throw new FinanceError('Some fields are invalid.', 'VALIDATION_FAILED', 400);
      return this.r().raiseException(c, { targetType: t, targetId: String(b?.targetId ?? ''), kind, note: b?.note ?? null },
        async (input) => ({ id: (await this.x().create(c, { ...input, kind: input.kind as never })).id }));
    });
  }
  @Post('exceptions/:exceptionId/assign') @RequirePermission('reconciliation.manage')
  assign(@Req() req: any, @Param('exceptionId') id: string, @Body(ValidatedBody(RECON_WORKSPACE_ASSIGN_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(async () => { const r = await this.x().assign(c, id, b?.assigneeUserId ?? null); await this.r().auditException(c, id, 'exception_assigned', { assigneeUserId: b?.assigneeUserId ?? null }); return r; });
  }
  @Post('exceptions/:exceptionId/review') @RequirePermission('reconciliation.manage')
  review(@Req() req: any, @Param('exceptionId') id: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(async () => { const r = await this.x().transition(c, id, 'in_review'); await this.r().auditException(c, id, 'exception_under_review', {}); return r; });
  }
  @Post('exceptions/:exceptionId/resolve') @RequirePermission('reconciliation.approve')
  resolve(@Req() req: any, @Param('exceptionId') id: string, @Body(ValidatedBody(RECON_RESOLVE_BODY, { strict: true })) b: any) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.approve');
    return runFinance(async () => { const r = await this.x().resolve(c, id, String(b?.reason ?? '')); await this.r().auditException(c, id, 'exception_resolved', { reasonLength: String(b?.reason ?? '').length }); return r; });
  }
  @Post('exceptions/:exceptionId/reopen') @RequirePermission('reconciliation.manage')
  reopen(@Req() req: any, @Param('exceptionId') id: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.manage');
    return runFinance(async () => { const r = await this.x().reopen(c, id); await this.r().auditException(c, id, 'exception_reopened', {}); return r; });
  }

  // ── reports ──
  @Get('reports/:reportType') @RequirePermission('reconciliation.view') @ListQuery(SCOPE_LIST)
  report(@Req() req: any, @Param('reportType') type: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string,
    @Query('processor') processor?: string, @Query('bankAccountId') bankAccountId?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const t = oneOf(type, REPORT_TYPES, 'reportType') as ReportType;
      const f = await this.scope(c, { preset, from, to, dateField, processor, bankAccountId, status });
      return { ...(await this.r().report(c, t, f, pageReq({ page, pageSize }))), period: f.period };
    });
  }
  @AsyncExport({ kind: 'pos.deposit-reconciliation.report-export' })
  @Get('reports/:reportType/export') @RequirePermission('reconciliation.view') @ListQuery(SCOPE_LIST) @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="reconciliation-report.csv"')
  reportCsv(@Req() req: any, @Param('reportType') type: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('dateField') dateField?: string,
    @Query('processor') processor?: string, @Query('bankAccountId') bankAccountId?: string, @Query('status') status?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const t = oneOf(type, REPORT_TYPES, 'reportType') as ReportType;
      return this.r().reportCsv(c, t, await this.scope(c, { preset, from, to, dateField, processor, bankAccountId, status }));
    });
  }
  @AsyncExport({ kind: 'pos.deposit-reconciliation.report-export-pdf' })
  @Get('reports/:reportType/export-pdf') @RequirePermission('reconciliation.view') @ListQuery(SCOPE_LIST)
  async reportPdf(@Req() req: any, @Res({ passthrough: true }) res: any, @Param('reportType') type: string, @Query('preset') preset?: string, @Query('from') from?: string, @Query('to') to?: string,
    @Query('dateField') dateField?: string, @Query('processor') processor?: string, @Query('bankAccountId') bankAccountId?: string, @Query('status') status?: string) {
    const c = financeCtx(req); needPermission(c, 'reconciliation.view');
    return runFinance(async () => {
      const t = oneOf(type, REPORT_TYPES, 'reportType') as ReportType;
      const f = await this.scope(c, { preset, from, to, dateField, processor, bankAccountId, status });
      const all = await this.r().reportForPdf(c, t, f);
      const p = f.period;
      const pdf = renderReportPdf({
        title: `Deposit reconciliation — ${t.replace(/_/g, ' ')}`, definition: all.definition, salonName: req?.ctx?.salonName,
        scope: [['Generated', new Date().toISOString()], ['Period', p.from && p.to ? `${p.from} to ${p.to} (${p.tz})` : 'All time'], ['Date basis', all.dateBasis.replace(/_/g, ' ')], ['Currency', 'USD']],
        columns: all.columns, rows: all.rows.map((row) => all.columns.map((col) => (col.money ? money(Number(row[col.key] ?? 0)) : String(row[col.key] ?? '')))),
        totals: Object.entries(all.totals).map(([k, v]) => [`Total ${k.replace(/Cents$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()}`, /Cents$/.test(k) ? money(v) : String(v)]),
      });
      res?.setHeader?.('Content-Type', 'application/pdf');
      res?.setHeader?.('Content-Disposition', `attachment; filename="reconciliation-${t}.pdf"`);
      return pdf;
    });
  }
}
