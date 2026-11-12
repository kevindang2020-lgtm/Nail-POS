// posExpensesApi.ts — Payments → Receipts & Expenses. The finance module's routes (/owner/finance/*: owner.expenses.view
// read, .manage write, .approve approve/reject/void, .export export; tenant-scoped + branch-access-aware server-side).
// The older /owner/expenses* calls are kept (they now delegate to the same finance service) so nothing that used them breaks.
import { api } from "./client";

const enc = encodeURIComponent;
import type { FinanceRulePreview, FinanceExportPreflight, FinanceBillsDue } from '@aipowersalon/api-contracts/tenant';
import type { FinanceInboxTab, FinanceExpense, FinanceCategory, FinanceDashboard, FinanceReport, FinanceExportPayload, FinanceExpensePage, FinanceCategoryList, FinanceCategoryRecommendation, FinanceExpenseCreateResult, FinanceExpenseCreateRequest, FinanceAttachResult, FinancePaymentMatch, FinancePaymentLinkRequest, FinanceSettings, FinanceSettingsRequest, FinanceExpenseSummary, FinanceExpenseUpdateRequest, FinanceExpenseResult, FinanceExpenseDetail } from '@aipowersalon/api-contracts/tenant';
export type ExpenseTab = FinanceInboxTab;
/** Extras (Expenses Management 01): the attention bar's click-through (the server lists by the same rule it counts) */
export type ExpenseAttention = 'no_receipt' | 'uncategorized' | 'overdue_review';
export type RulePreview = FinanceRulePreview;
export type ExportPreflight = FinanceExportPreflight;
export type { FinanceExpenseSummary as FinSummary, FinanceExpenseDetail as FinDetail, FinanceExpense as FinExpense, FinanceCategory as FinCategory, FinanceDashboard as FinDashboard, FinanceReport as FinReport, FinanceExportPayload };

export const posExpensesApi = {
  // the finance module
  dashboard: () => api.get<FinanceDashboard>(`/owner/finance/dashboard`),
  report: (period: string) => api.get<FinanceReport>(`/owner/finance/reports`, { period }),
  reportRange: (from: string, to: string) => api.get<FinanceReport>(`/owner/finance/reports`, { period: 'custom', from, to }),
  expenses: (q: { tab: ExpenseTab | 'all'; period?: string; from?: string; to?: string; q?: string; category?: string; paymentMethod?: string; sort?: 'created' | 'date' | 'amount'; page?: number; pageSize?: number; attention?: ExpenseAttention }) => api.get<FinanceExpensePage>(`/owner/finance/expenses`, q),
  /** Expenses guide (Nov 4 2026): the four KPIs over the whole filtered set, with the period the server resolved */
  kpis: (q: { period?: string; from?: string; to?: string; q?: string; category?: string; paymentMethod?: string; trend?: '1' }) => api.get<FinanceExpenseSummary>(`/owner/finance/expenses/summary`, q),
  update: (id: string, body: FinanceExpenseUpdateRequest) => api.patch<FinanceExpenseResult>(`/owner/finance/expenses/${enc(id)}`, body as unknown as Record<string, unknown>),
  detail: (id: string) => api.get<FinanceExpenseDetail>(`/owner/finance/expenses/${enc(id)}`),
  /** Bill due calendar (Extras · Receipt Expense OCR 06): open bills due within `days` of the salon's today, overdue first */
  billsDue: (days: number) => api.get<FinanceBillsDue>(`/owner/finance/expenses/bills-due`, { days }),
  categories: () => api.get<FinanceCategoryList>(`/owner/finance/expense-categories`),
  /** Vendor rule (Extras · Receipt Expense OCR 05): preview first (read-only), then save through the existing rules route */
  rulePreview: (vendor: string, categoryKey: string) => api.post<RulePreview>(`/owner/finance/expense-rules/preview`, { vendor, categoryKey }),
  createRule: (vendor: string, categoryKey: string) => api.post<{ id: string }>(`/owner/finance/expense-rules`, { vendor, categoryKey }),
  recommend: (vendor: string) => api.post<FinanceCategoryRecommendation>(`/owner/finance/expenses/recommend-category`, { vendor }),
  createExpense: (body: FinanceExpenseCreateRequest) => api.post<FinanceExpenseCreateResult>(`/owner/finance/expenses`, body as unknown as Record<string, unknown>),
  submit: (id: string, version: number) => api.post(`/owner/finance/expenses/${enc(id)}/submit`, { version }),
  approve: (id: string, version: number) => api.post(`/owner/finance/expenses/${enc(id)}/approve`, { version }),
  reject: (id: string, reason: string, version: number) => api.post(`/owner/finance/expenses/${enc(id)}/reject`, { reason, version }),
  voidExpense: (id: string, reason: string, version: number) => api.post(`/owner/finance/expenses/${enc(id)}/void`, { reason, version }),
  archive: (id: string) => api.post(`/owner/finance/expenses/${enc(id)}/archive`, {}),
  restore: (id: string) => api.post(`/owner/finance/expenses/${enc(id)}/restore`, {}),
  deleteDraft: (id: string) => api.del(`/owner/finance/expenses/${enc(id)}`),
  duplicateDecision: (id: string, decision: 'not_duplicate' | 'duplicate', reason: string) => api.post(`/owner/finance/expenses/${enc(id)}/duplicate-decision`, { decision, reason }),
  billPayment: (id: string, amountCents: number, idempotencyKey: string) => api.post(`/owner/finance/expenses/${enc(id)}/bill-payments`, { amountCents, idempotencyKey }),
  /** Accountant export preflight (Extras · Receipt Expense OCR 09): the export's own rows, checked — read-only */
  exportPreflight: (period: string, filters: { from?: string; to?: string; category?: string; paymentMethod?: string; q?: string } = {}) => api.get<ExportPreflight>(`/owner/finance/expenses/export/preflight`, { period, ...filters }),
  exportFile: (format: 'csv' | 'xlsx' | 'pdf', period: string, filters: { from?: string; to?: string; category?: string; paymentMethod?: string; q?: string } = {}) => api.exportAsync<FinanceExportPayload>(`/owner/finance/expenses/export`, { format, period, ...filters }, 'json'),
  // Oct 27 2026 — §142 the receipt document carries the finance suggestion of an existing expense; a person links it here
  attachReceipt: (expenseId: string, documentId: string) => api.post<FinanceAttachResult>(`/owner/finance/expenses/${enc(expenseId)}/documents`, { documentId, role: 'receipt' }),
  // §62/§63 the payment / bank transaction behind an expense — looked up (UNMATCHED honestly without a feed), linked or cleared by a person
  paymentMatch: (id: string) => api.post<FinancePaymentMatch>(`/owner/finance/expenses/${enc(id)}/payment-match`, {}),
  paymentLink: (id: string, body: FinancePaymentLinkRequest) => api.post(`/owner/finance/expenses/${enc(id)}/payment-link`, body as unknown as Record<string, unknown>),
  // §177 / §83 settings: notification preferences and the owner's auto-approval rules
  settings: () => api.get<FinanceSettings>(`/owner/finance/expense-settings`),
  saveSettings: (body: FinanceSettingsRequest) => api.put<FinanceSettings>(`/owner/finance/expense-settings`, body as unknown as Record<string, unknown>),

  // the older ledger routes (delegating to the finance module) — kept for anything that still calls them
  list: (period?: string) => api.get(`/owner/expenses`, period ? { period } : undefined),
  summary: (period?: string) => api.get(`/owner/expenses/summary`, period ? { period } : undefined),
  create: (body: Record<string, unknown>) => api.post(`/owner/expenses`, body),
  remove: (id: string) => api.del(`/owner/expenses/${id}`),
};

/** a finance export (base64 from the server) → a file the browser saves */
export function saveExportFile(f: FinanceExportPayload): void {
  const bin = atob(f.content); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
  const a = document.createElement('a'); a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
