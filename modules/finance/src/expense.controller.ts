// expense.controller.ts — the finance HTTP surface (/owner/finance/*). Thin (mandate §189): authenticate, authorize the
// route's permission, validate the body, call ExpenseService, serialize. Tenant + branch come from the session (req.ctx);
// the service applies the server-resolved branch scope. ExpenseError → its standard HTTP status + code (§143).
// The Owner App's older /owner/expenses* routes stay (OwnerController) and delegate to the same service.
import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody, AsyncExport } from '@aipowersalon/permissions/guards';
import { ListQueries } from '@aipowersalon/database';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { ExpenseService, ALL_BRANCHES, type FinanceCtx } from './expense.service';
import { ExpenseError } from './expense-errors';
import { ExpenseControllerListQueries } from './expense.list-queries';
import type { ReportPeriod } from './expense-reports';
import type { InboxTab } from './expense.repository';
import type {
  FinanceDashboard, FinanceReport, FinanceExportPayload, FinanceVendorSpend, FinanceExpensePage, FinanceExpenseSummary, FinanceExpenseDetail, FinanceExpenseCreateResult, FinanceExpenseResult,
  FinanceDeleteResult, FinanceAttachResult, FinanceArchiveResult, FinanceBatchResult, FinanceDuplicateResult, FinanceCategoryRecommendation, FinanceImportResult, FinanceCategoryList,
  FinanceCategoryResult, FinanceRuleList, FinanceRuleResult, FinanceSettings, FinanceExpenseCreateRequest, FinanceExpenseUpdateRequest, FinanceVersionRequest,
  FinanceReasonRequest, FinanceDuplicateDecisionRequest, FinanceBillPaymentRequest, FinanceReimbursementRequest, FinanceAttachRequest, FinanceIdsRequest,
  FinanceCategoryRequest, FinanceRuleRequest, FinanceSettingsRequest, FinanceDuplicateCheckRequest, FinanceRecommendRequest, FinanceImportRequest,
  FinancePaymentMatch, FinancePaymentLinkRequest, FinanceReceiptSuggestion,
} from '@aipowersalon/api-contracts/tenant';
import {
  FIN_EXPENSE_CREATE_BODY, FIN_EXPENSE_UPDATE_BODY, FIN_VERSION_BODY, FIN_REASON_BODY, FIN_DUPLICATE_BODY, FIN_BILL_PAYMENT_BODY, FIN_REIMBURSEMENT_BODY,
  FIN_ATTACH_BODY, FIN_IDS_BODY, FIN_CATEGORY_BODY, FIN_RULE_BODY, FIN_SETTINGS_BODY, FIN_DUP_CHECK_BODY, FIN_RECOMMEND_BODY, FIN_IMPORT_BODY, FIN_PAYMENT_LINK_BODY,
} from './request-schemas';

interface Req { ctx?: { tenantId?: string; userId?: string; role?: string; permissions?: string[]; branchId?: string | null } }
export function financeCtx(req: Req, branchId?: string | null): FinanceCtx {
  const c = req?.ctx ?? {};
  // ALL_BRANCHES ('all') is a read filter, never a branch: the session's branch stays the default for writes
  return { tenantId: String(c.tenantId ?? ''), userId: String(c.userId ?? ''), role: String(c.role ?? ''), permissions: c.permissions ?? [], selectedBranchId: (branchId && branchId !== ALL_BRANCHES ? branchId : null) || c.branchId || null };
}
export async function financeRun<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ExpenseError) throw new HttpException({ ok: false, code: e.code, message: e.message, ...e.extra }, e.status);
    if (e instanceof InvalidStateTransitionError) throw new HttpException({ ok: false, code: 'EXPENSE_INVALID_STATE', message: 'That cannot be done in the current state.' }, 409);
    throw e;
  }
}
const PERIODS = new Set(['today', 'week', 'month', 'year', 'last_month', 'last_year', 'custom']);
const period = (p?: string): ReportPeriod | undefined => (p && PERIODS.has(p) ? (p as ReportPeriod) : undefined);
const int = (v?: string) => (v != null && v !== '' && /^\d+$/.test(v) ? Number(v) : undefined);
const centsQ = (v?: string) => (v != null && v !== '' && /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : undefined);

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@ListQueries(ExpenseControllerListQueries)
@Controller('owner/finance')
export class ExpenseController {
  constructor(private readonly svc: ExpenseService) {}

  // ── dashboard, reports, export ─────────────────────────────────────────────────────────────────────────────────────
  @RequirePermission('owner.expenses.view') @Get('dashboard') dashboard(@Req() r: Req, @Query('branchId') branchId?: string): Promise<FinanceDashboard> { return financeRun(() => this.svc.dashboard(financeCtx(r, branchId), branchId || null)); }
  @RequirePermission('owner.expenses.view') @Get('reports') report(@Req() r: Req, @Query('period') p?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string): Promise<FinanceReport> {
    return financeRun(() => this.svc.report(financeCtx(r, branchId), { period: period(p), from, to, branchId: branchId || null }));
  }
  @AsyncExport({ kind: 'owner.finance.expenses.export', maxSyncRows: 20_000, estimate: { table: 'expenses' } })
  @RequirePermission('owner.expenses.export') @Get('expenses/export') async exportFile(@Req() r: Req, @Query('format') format?: string, @Query('period') p?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string, @Query('includeUnapproved') inc?: string, @Query('category') category?: string, @Query('paymentMethod') paymentMethod?: string, @Query('q') search?: string): Promise<FinanceExportPayload> {
    return financeRun(async () => {
      const f = await this.svc.exportFile(financeCtx(r, branchId), { format: format === 'xlsx' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv', period: period(p), from, to, branchId: branchId || null, includeUnapproved: inc === '1' || inc === 'true', category: category || undefined, paymentMethod: paymentMethod || undefined, q: search || undefined });
      return { filename: f.filename, contentType: f.contentType, encoding: 'base64', content: Buffer.from(f.bytes).toString('base64'), rowCount: f.rows, totalCents: f.totalCents };
    });
  }
  @RequirePermission('owner.expenses.view') @Get('vendors/:vendorId/spend') vendorSpend(@Req() r: Req, @Param('vendorId') vendorId: string, @Query('branchId') branchId?: string): Promise<FinanceVendorSpend> { return financeRun(() => this.svc.vendorSpend(financeCtx(r, branchId), vendorId, branchId || null)); }

  // ── expenses ─────────────────────────────────────────────────────────────────────────────────────────────────────
  @RequirePermission('owner.expenses.view') @Get('expenses') list(@Req() r: Req, @Query() q: Record<string, string | undefined>): Promise<FinanceExpensePage> {
    return financeRun(() => this.svc.list(financeCtx(r, q.branchId), { tab: (q.tab as InboxTab) || 'all', from: q.from, to: q.to, period: period(q.period) ?? null, category: q.category, vendorId: q.vendorId, status: q.status,
      paymentMethod: q.paymentMethod, q: q.q, minCents: centsQ(q.minCents), maxCents: centsQ(q.maxCents), page: int(q.page), pageSize: int(q.pageSize ?? q.limit), sort: q.sort === 'amount' || q.sort === 'created' ? q.sort : 'date', branchId: q.branchId || null }));
  }
  // Expenses guide (Nov 4 2026): declared before expenses/:id so "summary" is never read as an expense id
  @RequirePermission('owner.expenses.view') @Get('expenses/summary') summary(@Req() r: Req, @Query() q: Record<string, string | undefined>): Promise<FinanceExpenseSummary> {
    return financeRun(() => this.svc.summary(financeCtx(r, q.branchId), { from: q.from, to: q.to, period: period(q.period) ?? null, category: q.category, paymentMethod: q.paymentMethod, q: q.q, branchId: q.branchId || null }));
  }
  @RequirePermission('owner.expenses.view') @Get('expenses/:id') detail(@Req() r: Req, @Param('id') id: string): Promise<FinanceExpenseDetail> { return financeRun(() => this.svc.detail(financeCtx(r), id)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses') create(@Req() r: Req, @Body(ValidatedBody(FIN_EXPENSE_CREATE_BODY, { strict: true })) b: FinanceExpenseCreateRequest): Promise<FinanceExpenseCreateResult> { return financeRun(() => this.svc.create(financeCtx(r), b as never)); }
  @RequirePermission('owner.expenses.manage') @Patch('expenses/:id') update(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_EXPENSE_UPDATE_BODY, { strict: true })) b: FinanceExpenseUpdateRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.update(financeCtx(r), id, b as never)); }
  @RequirePermission('owner.expenses.manage') @Delete('expenses/:id') remove(@Req() r: Req, @Param('id') id: string): Promise<FinanceDeleteResult> { return financeRun(() => this.svc.deleteDraft(financeCtx(r), id)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/submit') submit(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_VERSION_BODY, { strict: true })) b: FinanceVersionRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.submit(financeCtx(r), id, b?.version ?? undefined)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/return-to-draft') toDraft(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_VERSION_BODY, { strict: true })) b: FinanceVersionRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.returnToDraft(financeCtx(r), id, b?.version ?? undefined)); }
  @RequirePermission('owner.expenses.approve') @Post('expenses/:id/approve') approve(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_VERSION_BODY, { strict: true })) b: FinanceVersionRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.approve(financeCtx(r), id, b?.version ?? undefined)); }
  @RequirePermission('owner.expenses.approve') @Post('expenses/:id/reject') reject(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_REASON_BODY, { strict: true })) b: FinanceReasonRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.reject(financeCtx(r), id, b.reason, b.version ?? undefined)); }
  @RequirePermission('owner.expenses.approve') @Post('expenses/:id/void') void_(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_REASON_BODY, { strict: true })) b: FinanceReasonRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.void(financeCtx(r), id, b.reason, b.version ?? undefined)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/archive') archive(@Req() r: Req, @Param('id') id: string): Promise<FinanceArchiveResult> { return financeRun(() => this.svc.archive(financeCtx(r), id, false)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/restore') restore(@Req() r: Req, @Param('id') id: string): Promise<FinanceArchiveResult> { return financeRun(() => this.svc.archive(financeCtx(r), id, true)); }
  @RequirePermission('owner.expenses.approve') @Post('expenses/:id/duplicate-decision') duplicate(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_DUPLICATE_BODY, { strict: true })) b: FinanceDuplicateDecisionRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.resolveDuplicate(financeCtx(r), id, b.decision, b.reason)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/bill-payments') billPayment(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_BILL_PAYMENT_BODY, { strict: true })) b: FinanceBillPaymentRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.recordBillPayment(financeCtx(r), id, b as never)); }
  @RequirePermission('owner.expenses.view') @Post('expenses/:id/reimbursement') reimbursement(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_REIMBURSEMENT_BODY, { strict: true })) b: FinanceReimbursementRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.reimbursement(financeCtx(r), id, b.action, b.reason)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/documents') attach(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_ATTACH_BODY, { strict: true })) b: FinanceAttachRequest): Promise<FinanceAttachResult> { return financeRun(() => this.svc.attachDocument(financeCtx(r), id, b.documentId, b.role ?? 'supporting')); }
  // §62/§63 (Oct 27 2026): the payment / bank transaction behind an expense — looked up (UNMATCHED honestly when no feed is
  // connected), or linked / cleared by a person; §142: the existing expense a receipt could be the evidence for (a suggestion)
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/payment-match') paymentMatch(@Req() r: Req, @Param('id') id: string): Promise<FinancePaymentMatch> { return financeRun(() => this.svc.matchPayment(financeCtx(r), id)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/:id/payment-link') paymentLink(@Req() r: Req, @Param('id') id: string, @Body(ValidatedBody(FIN_PAYMENT_LINK_BODY, { strict: true })) b: FinancePaymentLinkRequest): Promise<FinanceExpenseResult> { return financeRun(() => this.svc.setPaymentMatch(financeCtx(r), id, b)); }
  @RequirePermission('owner.expenses.view') @Get('receipts/:documentId/suggested-expense') suggestedExpense(@Req() r: Req, @Param('documentId') documentId: string): Promise<FinanceReceiptSuggestion> { return financeRun(() => this.svc.suggestExpenseForReceipt(financeCtx(r), documentId)); }
  @RequirePermission('owner.expenses.approve') @Post('expenses/batch/approve') batchApprove(@Req() r: Req, @Body(ValidatedBody(FIN_IDS_BODY, { strict: true })) b: FinanceIdsRequest): Promise<FinanceBatchResult> { return financeRun(() => this.svc.approveHighConfidence(financeCtx(r), b.ids, b.threshold ?? 0.95)); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/batch/categorize') batchCategorize(@Req() r: Req, @Body(ValidatedBody(FIN_IDS_BODY, { strict: true })) b: FinanceIdsRequest): Promise<FinanceBatchResult> { return financeRun(() => this.svc.bulkCategorize(financeCtx(r), b.ids, b.categoryKey ?? '')); }
  @RequirePermission('owner.expenses.view') @Post('expenses/check-duplicates') checkDup(@Req() r: Req, @Body(ValidatedBody(FIN_DUP_CHECK_BODY, { strict: true })) b: FinanceDuplicateCheckRequest): Promise<FinanceDuplicateResult> { return financeRun(() => this.svc.checkDuplicates(financeCtx(r), b as never)); }
  @RequirePermission('owner.expenses.view') @Post('expenses/recommend-category') recommend(@Req() r: Req, @Body(ValidatedBody(FIN_RECOMMEND_BODY, { strict: true })) b: FinanceRecommendRequest): Promise<FinanceCategoryRecommendation> { return financeRun(() => this.svc.recommend(financeCtx(r), { vendor: b.vendor ?? null, lines: b.lines ?? [] })); }
  @RequirePermission('owner.expenses.manage') @Post('expenses/import') importCsv(@Req() r: Req, @Body(ValidatedBody(FIN_IMPORT_BODY, { strict: true })) b: FinanceImportRequest): Promise<FinanceImportResult> { return financeRun(() => this.svc.importRows(financeCtx(r), b.rows as never, { dryRun: !!b.dryRun })); }

  // ── categories, rules, settings ────────────────────────────────────────────────────────────────────────────────
  @RequirePermission('owner.expenses.view') @Get('expense-categories') categories(@Req() r: Req): Promise<FinanceCategoryList> { return financeRun(() => this.svc.categories(financeCtx(r))); }
  @RequirePermission('owner.expenses.categories.manage') @Post('expense-categories') createCategory(@Req() r: Req, @Body(ValidatedBody(FIN_CATEGORY_BODY, { strict: true })) b: FinanceCategoryRequest): Promise<FinanceCategoryResult> { return financeRun(() => this.svc.createCategory(financeCtx(r), { label: b.label ?? '', accountingCode: b.accountingCode ?? null })); }
  @RequirePermission('owner.expenses.categories.manage') @Patch('expense-categories/:key') updateCategory(@Req() r: Req, @Param('key') key: string, @Body(ValidatedBody(FIN_CATEGORY_BODY, { strict: true })) b: FinanceCategoryRequest): Promise<FinanceCategoryResult> { return financeRun(() => this.svc.updateCategory(financeCtx(r), key, b)); }
  @RequirePermission('owner.expenses.view') @Get('expense-rules') rules(@Req() r: Req): Promise<FinanceRuleList> { return financeRun(() => this.svc.rules(financeCtx(r))); }
  @RequirePermission('owner.expenses.categories.manage') @Post('expense-rules') createRule(@Req() r: Req, @Body(ValidatedBody(FIN_RULE_BODY, { strict: true })) b: FinanceRuleRequest): Promise<FinanceRuleResult> { return financeRun(() => this.svc.createRule(financeCtx(r), b)); }
  @RequirePermission('owner.expenses.categories.manage') @Delete('expense-rules/:id') deleteRule(@Req() r: Req, @Param('id') id: string): Promise<FinanceRuleResult> { return financeRun(() => this.svc.deleteRule(financeCtx(r), id)); }
  @RequirePermission('owner.expenses.view') @Get('expense-settings') settings(@Req() r: Req): Promise<FinanceSettings> { return financeRun(() => this.svc.settings(financeCtx(r))); }
  @RequirePermission('owner.expenses.categories.manage') @Put('expense-settings') saveSettings(@Req() r: Req, @Body(ValidatedBody(FIN_SETTINGS_BODY, { strict: true })) b: FinanceSettingsRequest): Promise<FinanceSettings> { return financeRun(() => this.svc.saveSettings(financeCtx(r), b as never)); }
}
