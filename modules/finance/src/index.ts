// @aipowersalon/finance — Receipt → Expense → Category → Vendor → Reports → Accounting export (mandate Oct 21 2026).
export { FinanceModule, UnboundBranchScope } from './finance.module';
export { ExpenseService, type FinanceCtx, type BranchScopePort, type VendorDirectoryPort, type AiCategoryPort, type FinanceAuditPort, type PaymentFeedPort, type ExpenseInput } from './expense.service';
export { matchReceiptToExpenses, matchExpenseToPayments, autoApprovalDecision, autoApprovalRulesOf, type MatchVerdict, type AutoApprovalRule, type PaymentCandidate } from './expense-matching';
export { digestsDue, lastCompletedWeekMonday, lastCompletedMonth, weeklySummary, monthlySummary } from './expense-digests';
export { ExpenseController, financeCtx, financeRun } from './expense.controller';
export { ExpenseRepository, type ExpenseRow, type ListFilters, type InboxTab, type Scope } from './expense.repository';
export { ExpenseError, EXPENSE_ERROR_MESSAGE, EXPENSE_ERROR_STATUS, type ExpenseErrorCode } from './expense-errors';
export { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_CATEGORY_KEYS, FALLBACK_CATEGORY, normalizeCategory, customCategoryKey, categoryLabel } from './expense-categories';
export { recommendCategory, learnFromCorrection, type CategoryRecommendation, type CategoryRule, type CategorySource } from './category-engine';
export { normalizeVendorName, matchVendor, vendorSimilarity } from './vendor-normalize';
export { reconcileBreakdown, parseCents, allocate, billStatusFor, billDueState, roundHalfUp, branchShareOfSalonWide, validSharedCostShares, type SharedCostPolicy, type SharedCostShare } from './expense-money';
export { detectExpenseDuplicates, hashDistance } from './expense-duplicates';
export { EXPENSE, EXPENSE_BILL, EXPENSE_REIMBURSEMENT, EXPENSE_DUPLICATE, COUNTED_STATUSES } from './expense-lifecycles';
export { periodWindow, previousWindow, pctChange, detectRecurring, expenseInsights, type ReportPeriod } from './expense-reports';
export { toExpenseCsv, toExpenseXlsx, EXPORT_HEADERS, dollars, ACCOUNTING_EXPORT_ADAPTERS, csvExportAdapter, xlsxExportAdapter, pdfExportAdapter, type AccountingExportPort } from './expense-export';
export * from './request-schemas';
export { BillReminderScheduler, billRemindersEnabled } from './bill-reminder.scheduler';
