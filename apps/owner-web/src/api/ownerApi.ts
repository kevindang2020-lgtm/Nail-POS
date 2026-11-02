// ownerApi.ts — Owner App API hooks over the shared fetch client. Pass 1: the Home dashboard. The server derives
// tenant + branch authorization from the session; only an optional selected branchId is ever sent (a real branch the
// session is allowed to view), never tenant context.
import type { BonusMetric, BonusPreview, BonusRuleRow, CashPoolSummary, ClassificationRow, ComplianceFlag, CompliancePreview, DailyCashSummary, EarnedBonus, OwnerAlert, OwnerAlertSeverity, OwnerAlertStatus, OwnerAlertSummary, OwnerAllowedBranch, OwnerAppointmentListItem, OwnerApprovalItem, OwnerAuditEntry, OwnerBookingOverview, OwnerBranchPerformanceState, OwnerContextResponse, OwnerCustomerKpis, OwnerDashboardState, OwnerDrawerRow, OwnerDrawerSummary, OwnerExpense, OwnerExpenseInput, OwnerExpenseSummary, OwnerFinanceSummary, OwnerInventoryCategory, OwnerInventoryReorderItem, OwnerInventoryStatusCounts, OwnerLiveQueueRow, OwnerLiveTeamRow, OwnerLiveTechRow, OwnerLivePage, OwnerLiveOpsQuery, OwnerLoyaltyOverview, OwnerLoyaltyTier, OwnerMarketingCampaign, OwnerMarketingChannel, OwnerMarketingKpis, OwnerPaymentMethod, OwnerPaymentMethodSlice, OwnerPaymentMix, OwnerPaymentRefund, OwnerPaymentTxn, OwnerPaymentsSummary, OwnerPayrollKpis, OwnerPayrollLine, OwnerPayrollPeriodStatus, OwnerPayrollPeriodSummary, OwnerPeriod, OwnerProfileCard, OwnerReportExport, OwnerReportInfo, OwnerSalonOverview, OwnerSettingsSnapshot, OwnerStaffAttendance, OwnerStaffPerformancePage, OwnerStaffPerformanceSort, OwnerStaffPerformanceState, OwnerTechnicianDetail, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTicketRow, OwnerTopSpender, OwnerTopTechnician, PeriodBonusReview, PeriodBonusTech, PeriodComplianceRow, RetailMethod, RetailPolicy, TierBand, WageConfig, WorkerClassification } from '@aipowersalon/api-contracts/tenant';
import type { PaycheckWeek, PaycheckOwnerSummary, PayStatementDetail, PayrollTechnicianDetail } from '@aipowersalon/api-contracts/tenant';
import type { FinanceDashboard, FinanceReport, FinanceInboxTab, FinanceExpensePage, FinanceCategoryList, FinanceCategoryResult, FinanceRuleList, FinanceRuleResult, FinanceSettings, FinanceSettingsRequest, FinanceExpenseCreateRequest, FinanceExpenseCreateResult, FinanceExpenseUpdateRequest, FinanceExpenseResult, FinanceDeleteResult, FinanceExportPayload, FinanceExpense, FinanceCategory, FinanceRule, FinanceVendorSpend, FinanceReimbursementRequest, FinanceAttachResult, FinanceBatchResult, FinanceDuplicateCheckRequest, FinanceDuplicateResult, FinanceImportRow, FinanceImportResult, FinanceReceiptSuggestion, OcrUploadResult, OcrPageAppendResult, OcrExtractionResult } from '@aipowersalon/api-contracts/tenant';
export type { FinanceDashboard, FinanceReport, FinanceInboxTab, FinanceExpense, FinanceCategory, FinanceRule, FinanceSettings, FinanceExportPayload, FinanceVendorSpend, FinanceDuplicateResult, FinanceImportRow };
export type { BonusMetric, BonusPreview, BonusRuleRow, CashPoolSummary, ClassificationRow, ComplianceFlag, CompliancePreview, DailyCashSummary, EarnedBonus, OwnerAlert, OwnerAlertSeverity, OwnerAlertStatus, OwnerAlertSummary, OwnerAllowedBranch, OwnerAppointmentListItem, OwnerApprovalItem, OwnerAuditEntry, OwnerBookingOverview, OwnerBranchPerformanceState, OwnerContextResponse, OwnerCustomerKpis, OwnerDashboardState, OwnerDrawerRow, OwnerDrawerSummary, OwnerExpense, OwnerExpenseInput, OwnerExpenseSummary, OwnerFinanceSummary, OwnerInventoryCategory, OwnerInventoryReorderItem, OwnerInventoryStatusCounts, OwnerLiveQueueRow, OwnerLiveTeamRow, OwnerLiveTechRow, OwnerLivePage, OwnerLiveOpsQuery, OwnerLoyaltyOverview, OwnerLoyaltyTier, OwnerMarketingCampaign, OwnerMarketingChannel, OwnerMarketingKpis, OwnerPaymentMethod, OwnerPaymentMethodSlice, OwnerPaymentMix, OwnerPaymentRefund, OwnerPaymentTxn, OwnerPaymentsSummary, OwnerPayrollKpis, OwnerPayrollLine, OwnerPayrollPeriodStatus, OwnerPayrollPeriodSummary, OwnerPeriod, OwnerProfileCard, OwnerReportExport, OwnerReportInfo, OwnerSalonOverview, OwnerSettingsSnapshot, OwnerStaffAttendance, OwnerStaffPerformancePage, OwnerStaffPerformanceSort, OwnerStaffPerformanceState, OwnerTechnicianDetail, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTicketRow, OwnerTopSpender, OwnerTopTechnician, PeriodBonusReview, PeriodBonusTech, PeriodComplianceRow, RetailMethod, RetailPolicy, TierBand, WageConfig, WorkerClassification };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';


export const ownerSalonsApi = {
  overview: () => api.get<OwnerSalonOverview[]>('/owner/salons/overview'),

};
export const ownerActivityApi = {
  // Fire-and-forget view ping on navigation; never blocks or surfaces errors in the UI.
  view: (screen: 'dashboard' | 'reports', branchId?: string) => api.post('/owner/activity', { screen, ...(branchId ? { branchId } : {}) }),
};
export const ownerContextApi = {
  // The owner's ASSIGNED BRANCHES within the active salon. This is NOT /owner/context — that path belongs to
  // owner-portfolio ("which salon is the session in?") and used to shadow this one, so this call was silently
  // getting the portfolio payload and `allowedBranches` came back undefined.
  context: () => api.get<OwnerContextResponse>('/owner/branch-context'),
  // Record the owner's salon switch (single branch or combined). When switching into a salon that has a 6-digit switch
  // PIN, that PIN is sent and verified server-side; a wrong/missing PIN rejects the switch (the UI prompts for it).
  select: (mode: 'single' | 'all', branchId?: string, pin?: string) => api.post<{ ok: boolean }>('/owner/context/select', { mode, ...(branchId ? { branchId } : {}), ...(pin ? { pin } : {}) }),
};

export const ownerDashboardApi = {
  state: (branchId?: string) => api.get<OwnerDashboardState>('/owner/dashboard/state', branchId ? { branchId } : undefined),
};

export const ownerBranchesApi = {
  performance: (period: OwnerPeriod) => api.get<OwnerBranchPerformanceState>('/owner/branches/performance', { period }),
  comparison: (period: OwnerPeriod) => api.get<OwnerBranchPerformanceState>('/owner/branches/comparison', { period }),
};

export const ownerBookingsApi = {
  overview: (period: 'today' | 'week', branchId?: string) => api.get<OwnerBookingOverview>('/owner/bookings/overview', { period, ...(branchId ? { branchId } : {}) }),
  drillDown: (opts: { period?: 'today' | 'week'; status?: string; branchId?: string; limit?: number }) => api.get<OwnerAppointmentListItem[]>('/owner/bookings/drill-down', opts as Record<string, unknown>),
};

export interface OwnerTicketListResp { tickets: OwnerTicketRow[]; total: number; page: number; pageSize: number; }
export interface OwnerTicketHistoryResp { ticket: OwnerTicketDetail; lines: OwnerTicketLine[]; revisions: OwnerTicketRevision[]; }

export const ownerTicketsApi = {
  list: (opts: { branchId?: string; status?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }) => api.get<OwnerTicketListResp>('/owner/tickets', opts as Record<string, unknown>),
  history: (id: string) => api.get<OwnerTicketHistoryResp>('/owner/tickets/' + encodeURIComponent(id) + '/history'),
};

export const ownerStaffApi = {
  performance: (period: OwnerPeriod, branchId?: string) => api.get<OwnerStaffPerformanceState>('/owner/staff/performance', { period, ...(branchId ? { branchId } : {}) }),
  attendance: (branchId?: string) => api.get<OwnerStaffAttendance>('/owner/staff/attendance', branchId ? { branchId } : undefined),
  // 200-technician mandate §62/§69/§71: every technician, paged / searched / sorted on the server
  technicians: (q: { period: OwnerPeriod; branchId?: string; search?: string; sort?: OwnerStaffPerformanceSort; dir?: 'asc' | 'desc'; page?: number; pageSize?: number }) =>
    api.get<OwnerStaffPerformancePage>('/owner/staff/performance/technicians', { period: q.period, ...(q.branchId ? { branchId: q.branchId } : {}), ...(q.search?.trim() ? { search: q.search.trim() } : {}),
      ...(q.sort ? { sort: q.sort } : {}), ...(q.dir ? { dir: q.dir } : {}), page: q.page ?? 1, pageSize: q.pageSize ?? 20 }),
  technician: (technicianId: string, period: OwnerPeriod) => api.get<OwnerTechnicianDetail>(`/owner/staff/${technicianId}/performance`, { period }),
};

export const ownerFinanceApi = {
  summary: (period: OwnerPeriod, branchId?: string) => api.get<OwnerFinanceSummary>('/owner/finance/summary', { period, ...(branchId ? { branchId } : {}) }),
  paymentMix: (period: OwnerPeriod, branchId?: string) => api.get<OwnerPaymentMix>('/owner/finance/payment-mix', { period, ...(branchId ? { branchId } : {}) }),
  reports: () => api.get<OwnerReportInfo[]>('/owner/reports'),
  export: (reportId: string, period: OwnerPeriod, branchId?: string) => api.exportAsync<OwnerReportExport>(`/owner/reports/${reportId}/export`, { period, ...(branchId ? { branchId } : {}) }),
};

/** the finance module's ten default category KEYS (modules/finance expense-categories.ts) — 'maintenance' became 'repairs' */
export const EXPENSE_CATEGORIES = ['rent', 'supplies', 'equipment', 'utilities', 'marketing', 'repairs', 'insurance', 'software', 'payroll', 'other'] as const;
export const ownerExpensesApi = {
  list: (period: OwnerPeriod, branchId?: string) => api.get<OwnerExpense[]>('/owner/expenses', { period, ...(branchId ? { branchId } : {}) }),
  summary: (period: OwnerPeriod, branchId?: string) => api.get<OwnerExpenseSummary>('/owner/expenses/summary', { period, ...(branchId ? { branchId } : {}) }),
  create: (input: OwnerExpenseInput) => api.post<OwnerExpense>('/owner/expenses', input as unknown as Record<string, unknown>),
  update: (id: string, patch: Partial<OwnerExpenseInput>) => api.patch<OwnerExpense>(`/owner/expenses/${id}`, patch as Record<string, unknown>),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/owner/expenses/${id}`),
};

/** Receipt/Expense/OCR/Accounting mandate (Oct 21 2026): the finance module's routes (/owner/finance/*) — the review inbox,
 *  approvals, bills, categories, the salon's own vendor→category rules, settings and the accountant export. */
const encF = encodeURIComponent;
// no branch chosen = every branch the owner may see (+ salon-wide costs) — said explicitly: the API's default for a
// request without a branch is the session's branch (the POS's view)
const br = (branchId?: string) => ({ branchId: branchId || 'all' });
export const ownerFinanceExpensesApi = {
  dashboard: (branchId?: string) => api.get<FinanceDashboard>('/owner/finance/dashboard', br(branchId)),
  report: (period: string, branchId?: string) => api.get<FinanceReport>('/owner/finance/reports', { period, ...br(branchId) }),
  list: (tab: FinanceInboxTab, period: string | undefined, branchId?: string) => api.get<FinanceExpensePage>('/owner/finance/expenses', { tab, ...(period ? { period } : {}), ...br(branchId) }),
  categories: () => api.get<FinanceCategoryList>('/owner/finance/expense-categories'),
  renameCategory: (key: string, label: string) => api.patch<FinanceCategoryResult>(`/owner/finance/expense-categories/${encF(key)}`, { label }),
  rules: () => api.get<FinanceRuleList>('/owner/finance/expense-rules'),
  addRule: (vendor: string, categoryKey: string) => api.post<FinanceRuleResult>('/owner/finance/expense-rules', { vendor, categoryKey }),
  removeRule: (id: string) => api.del<FinanceRuleResult>(`/owner/finance/expense-rules/${encF(id)}`),
  settings: () => api.get<FinanceSettings>('/owner/finance/expense-settings'),
  saveSettings: (patch: FinanceSettingsRequest) => api.put<FinanceSettings>('/owner/finance/expense-settings', patch as Record<string, unknown>),
  create: (body: FinanceExpenseCreateRequest) => api.post<FinanceExpenseCreateResult>('/owner/finance/expenses', body as unknown as Record<string, unknown>),
  update: (id: string, patch: FinanceExpenseUpdateRequest) => api.patch<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}`, patch as unknown as Record<string, unknown>),
  approve: (id: string, version: number) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/approve`, { version }),
  reject: (id: string, reason: string, version: number) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/reject`, { reason, version }),
  returnToDraft: (id: string, version: number) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/return-to-draft`, { version }),
  voidExpense: (id: string, reason: string, version: number) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/void`, { reason, version }),
  deleteDraft: (id: string) => api.del<FinanceDeleteResult>(`/owner/finance/expenses/${encF(id)}`),
  duplicateDecision: (id: string, decision: 'not_duplicate' | 'duplicate', reason: string) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/duplicate-decision`, { decision, reason }),
  billPayment: (id: string, amountCents: number, idempotencyKey: string) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/bill-payments`, { amountCents, idempotencyKey }),
  addCategory: (label: string) => api.post<FinanceCategoryResult>('/owner/finance/expense-categories', { label }),
  vendorSpend: (vendorId: string, branchId?: string) => api.get<FinanceVendorSpend>(`/owner/finance/vendors/${encF(vendorId)}/spend`, br(branchId)),
  reimbursement: (id: string, action: FinanceReimbursementRequest['action'], reason?: string) => api.post<FinanceExpenseResult>(`/owner/finance/expenses/${encF(id)}/reimbursement`, { action, ...(reason ? { reason } : {}) }),
  attach: (id: string, documentId: string) => api.post<FinanceAttachResult>(`/owner/finance/expenses/${encF(id)}/documents`, { documentId, role: 'supporting' }),
  batchCategorize: (ids: string[], categoryKey: string) => api.post<FinanceBatchResult>('/owner/finance/expenses/batch/categorize', { ids, categoryKey }),
  batchApprove: (ids: string[]) => api.post<FinanceBatchResult>('/owner/finance/expenses/batch/approve', { ids }),
  checkDuplicates: (body: FinanceDuplicateCheckRequest) => api.post<FinanceDuplicateResult>('/owner/finance/expenses/check-duplicates', body as unknown as Record<string, unknown>),
  importRows: (rows: FinanceImportRow[], dryRun: boolean) => api.post<FinanceImportResult>('/owner/finance/expenses/import', { rows, dryRun } as unknown as Record<string, unknown>),
  exportFile: (format: 'csv' | 'xlsx', period: string, branchId?: string) => api.exportAsync<FinanceExportPayload>('/owner/finance/expenses/export', { format, period, ...br(branchId) }, 'json'),
  /** a receipt photo or PDF → the Receipt AI pipeline (scan → read → a person reviews; nothing posts on its own) */
  uploadReceipt: (payload: { filename: string; mimeType: string; sizeBytes: number; bytes: number[]; headerBytes: number[]; source?: 'owner_app_upload' | 'mobile_camera'; deferExtraction?: boolean }) => api.post<OcrUploadResult>('/pos/ai-ocr-receipt/upload', payload as unknown as Record<string, unknown>),
  /** §17/§18 (Oct 27 2026): page 2, 3 … of ONE receipt document; then readReceipt runs the reading once the pages are in */
  addReceiptPage: (documentId: string, payload: { filename: string; mimeType: string; sizeBytes: number; bytes: number[]; headerBytes: number[] }) => api.post<OcrPageAppendResult>(`/pos/ai-ocr-receipt/documents/${encF(documentId)}/pages`, payload as unknown as Record<string, unknown>),
  readReceipt: (documentId: string) => api.post<OcrExtractionResult>(`/pos/ai-ocr-receipt/documents/${encF(documentId)}/extract`, {}),
  /** §142 (Oct 27 2026): is this receipt the evidence for an expense already recorded? (a suggestion — a person links it) */
  suggestedExpense: (documentId: string) => api.get<FinanceReceiptSuggestion>(`/owner/finance/receipts/${encF(documentId)}/suggested-expense`),
  /** link the receipt to that expense as ITS receipt (never a second expense) */
  linkReceipt: (expenseId: string, documentId: string) => api.post<FinanceAttachResult>(`/owner/finance/expenses/${encF(expenseId)}/documents`, { documentId, role: 'receipt' }),
};

export const ownerMoreApi = {
  profile: () => api.get<OwnerProfileCard>('/owner/profile'),
  uploadAvatar: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.upload<{ url: string }>('/owner/profile/avatar', fd); },
  settings: () => api.get<OwnerSettingsSnapshot>('/owner/settings'),
  alerts: (opts?: { status?: string; severity?: string }) => api.get<OwnerAlert[]>('/owner/alerts', opts as Record<string, unknown> | undefined),
  alertSummary: () => api.get<OwnerAlertSummary>('/owner/alerts/summary'),
  acknowledge: (id: string) => api.post<OwnerAlert>(`/owner/alerts/${id}/acknowledge`),
  resolve: (id: string) => api.post<OwnerAlert>(`/owner/alerts/${id}/resolve`),
  dismiss: (id: string) => api.post<OwnerAlert>(`/owner/alerts/${id}/dismiss`),
  /** developer merge (Oct 23 2026): "Mark all read" in one request — acknowledges every open alert server-side */
  markAllNotificationsRead: () => api.post<{ ok: true }>('/owner/notifications/read'),
  audit: (limit?: number) => api.get<OwnerAuditEntry[]>('/owner/audit', limit ? { limit } : undefined),
};

// Hardware Payment Recovery (owner-facing, read-only + autopay setup) — backend @Controller('owner/hardware-payment').
// Fiserv figures are stripped server-side; owners see their credit, what they owe, and any shortfall charged.
export interface OwnerHwPlan { id: string; status: string; monthlyPaymentCents: number; remainingBalanceCents: number; autoChargeShortfallEnabled: boolean; savedPaymentMethodId?: string | null }
export interface OwnerHwSavedMethod { brand: string | null; last4: string | null; status: string }
export interface OwnerHwPlanResponse { plan: OwnerHwPlan | null; savedPaymentMethod: OwnerHwSavedMethod | null }
// The owner invoice view strips Fiserv-internal figures AND the row id — ownerInvoices returns exactly these six fields.
export interface OwnerHwInvoice { billingMonth: string; hardwareMonthlyDueCents: number; salonHardwareCreditCents: number; shortfallCents: number; autoChargeAmountCents: number; status: string }
export const ownerHardwarePaymentApi = {
  plan: () => api.get<OwnerHwPlanResponse>('/owner/hardware-payment/plan'),
  invoices: () => api.get<OwnerHwInvoice[]>('/owner/hardware-payment/invoices'),
  tokenizer: () => api.get<{ available: boolean; url?: string; origin?: string; reason?: string }>('/owner/hardware-payment/tokenizer'),
  addMethod: (b: { gatewayPaymentMethodToken: string; brand?: string; last4?: string; expMonth?: number; expYear?: number }) => api.post<any>('/owner/hardware-payment/payment-method', b),
  consent: (planId: string) => api.post<any>('/owner/hardware-payment/autopay-consent', { planId }),
};


// End-of-Day Cash hand-off (read-only owner summary). Server derives tenant from the session.
export type OwnerHandoffStatus = 'open' | 'submitted' | 'reconciled' | 'discrepancy' | 'cancelled';
export interface OwnerCashHandoffRow {
  technicianId: string; technicianName: string; businessDate: string;
  expectedCents: number; paymentCount: number; countedCents: number | null; varianceCents: number | null;
  status: OwnerHandoffStatus; submittedAt: string | null; reconciledAt: string | null; notes: string | null;
}
export interface OwnerCashHandoffBoard {
  businessDate: string; technicians: OwnerCashHandoffRow[];
  totalExpectedCents: number; totalCountedCents: number; technicianCount: number; reconciledCount: number; openCount: number;
}
export const ownerCashHandoffApi = {
  state: (date?: string) => api.get<OwnerCashHandoffBoard>('/owner/cash-handoffs', date ? { date } : undefined),
};

// Apple-compliance: owner account deactivation request (business records retained; access disabled).
export interface OwnerAccountRequestResult { requestId: string; status: string; requestType: 'delete' | 'deactivate'; submittedAt: string; willRemove: string[]; willRetain: string[]; contactEmail: string | null; message: string }
export const ownerAccountApi = {
  /**
   * The owner's own personal data, as the law obliges us to hand it over on request.
   *
   * `@Get('owner/me/privacy-export')` has been live the whole time — guarded, permission-checked, building a
   * complete JSON payload. And OwnerPrivacyScreen was a page of prose ending in "Email privacy@aipowersalon.com".
   * So is the technician's. So is the customer's — `customerApi.privacyExport()` exists and NO SCREEN CALLS IT
   * EITHER. A right of access that is implemented on the server and unreachable in every client is not
   * implemented; it is a support ticket.
   */
  privacyExport: () => api.exportAsync<unknown>('/owner/me/privacy-export'),

  requestDeactivation: (reason?: string) => api.post<OwnerAccountRequestResult>('/owner/me/delete-account-request', reason ? { reason } : {}),
};

// Front-desk cash drawer — read-only owner oversight (per-branch register reconciliation, salon-wide).
export type OwnerDrawerStatus = 'open' | 'reconciled' | 'discrepancy' | 'cancelled';
export const ownerCashDrawerApi = {
  state: (date?: string) => api.get<OwnerDrawerSummary>('/owner/cash-drawer', date ? { date } : undefined),
};

export const ownerCashSummaryApi = {
  state: (date?: string) => api.get<DailyCashSummary>('/owner/cash-summary', date ? { date } : undefined),
};

// ---- Tenant-owner AI packages (the 15 paid AI assistants). Tenant scope is derived from the session server-side. ----
export interface OwnerAiPackage {
  code: string; name: string; description: string; category: string; posArea: string;
  monthlyPriceCents: number; includedUsageLimit: number; usageUnit: string; trialDays: number;
  subscription: { status: string; usageLimit: number; overageEnabled: boolean; trialEndsAt: string | null } | null;
  used: number; remainingUsage: number; accessible: boolean; lockReason: string | null; lockLabel: string | null;
  upgradeRequired: boolean; trialAvailable: boolean;
}
export const ownerAiApi = {
  packages: () => api.get<{ packages: OwnerAiPackage[] }>('/tenant/ai/packages'),
  startTrial: (packageCode: string) => api.post<{ ok: boolean; status: string; trialEndsAt: string | null }>('/tenant/ai/subscriptions', { packageCode }),
  cancel: (code: string) => api.patch<{ ok: boolean }>(`/tenant/ai/subscriptions/${encodeURIComponent(code)}/cancel`),
};

export interface OwnerLiveOperationsResp {
  branchId: string | null;
  counts: { waiting: number; serving: number; completedToday: number };
  techQueue: OwnerLiveTechRow[];
  liveQueue: OwnerLiveQueueRow[];
  /** every active technician in scope: live workforce state + today's sales / tips from the compensation snapshots */
  team?: OwnerLiveTeamRow[];
  /** each list's true size (200-technician mandate §62): the lists are bounded windows */
  totals?: { team: number; techQueue: number; liveQueue: number };
  /** 200-technician §2: the team and the in-service list are ONE server page each (total = matching the search / status) */
  teamPage?: OwnerLivePage;
  techQueuePage?: OwnerLivePage;
  todaySoFar: { servicesDone: number; walkIns: number };
  signals: { readyForCheckout: number; delayedAppointments: number };
  generatedAt: string;
}
export const ownerLiveApi = {
  get: (branchId?: string, q: OwnerLiveOpsQuery = {}) => {
    const query: Record<string, unknown> = Object.fromEntries(Object.entries({ branchId, ...q }).filter(([, v]) => v != null && v !== ''));
    return api.get<OwnerLiveOperationsResp>('/owner/live', Object.keys(query).length ? query : undefined);
  },
};

export interface OwnerPayrollListResp { periods: OwnerPayrollPeriodSummary[]; kpis: OwnerPayrollKpis }
export interface OwnerPayrollPeriodDetailResp {
  period: OwnerPayrollPeriodSummary;
  totals: { grossSalesCents: number; commissionCents: number; retailCommissionCents: number; cardTipCents: number; cashTipCents: number; tipsCents: number; guaranteeTopupCents: number; adjustmentCents: number; payableCents: number; technicianCount: number };
  lines: OwnerPayrollLine[];
}
// ── Compensation policy (salon 3+-technician tip-split rule, spec §11). Owner-gated. ──
export type TipSplitMethod = 'proportional' | 'equal';
export interface TipPolicyResp { manyTechTipMethod: TipSplitMethod }
// ── Compensation RULES (scoped, versioned commission rules — spec §5/§7/§25). Owner-gated (writes need manage). ──
export interface CompRuleScope { branchId: string | null; technicianId: string | null; serviceId: string | null; serviceCategory: string | null; ticketId: string | null }
export interface CompRuleVersion {
  id: string; version: number; commissionType: 'percent' | 'fixed'; commissionValue: number;
  supplyMethod: string; supplyValue: number; discountFunding: string;
  effectiveStart: string; effectiveEnd: string | null; status: string; approved: boolean; createdAt: string;
}
export interface CompRulePolicy { id: string; scope: CompRuleScope; label: string | null; createdAt: string; versions: CompRuleVersion[] }
export interface CompRuleVersionPayload {
  commissionType: 'percent' | 'fixed'; commissionValue: number; effectiveStart: string;
  effectiveEnd?: string | null; supplyMethod?: string; supplyValue?: number; discountFunding?: string;
}
export interface CreateCompRuleBody { scope?: Partial<CompRuleScope>; label?: string | null; version: CompRuleVersionPayload }
export interface TierPlan { id: string; technicianId: string; branchId: string | null; mode: 'entire' | 'marginal'; bands: TierBand[]; status: string; effectiveStart: string; createdAt: string }
export interface TierCalcResult { commissionCents: number; effectiveRatePercent: number }
export interface TierPreview { productionCents: number; entire: TierCalcResult; marginal: TierCalcResult }
export interface Agreement { id: string; technicianId: string; title: string; terms: Record<string, unknown>; status: string; version: number; effectiveStart: string; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null }
export const ownerCompensationApi = {
  tipPolicy: () => api.get<TipPolicyResp>('/owner/compensation/tip-policy'),
  setTipPolicy: (manyTechTipMethod: TipSplitMethod) => api.put<TipPolicyResp>('/owner/compensation/tip-policy', { manyTechTipMethod }),
  listRules: () => api.get<CompRulePolicy[]>('/owner/compensation/rules'),
  createRule: (body: CreateCompRuleBody) => api.post<CompRulePolicy>('/owner/compensation/rules', body as unknown as Record<string, unknown>),
  seedDefault: (technicianPercent = 60) => api.post<CompRulePolicy>('/owner/compensation/rules/seed-default', { technicianPercent }),
  addRuleVersion: (id: string, version: CompRuleVersionPayload) => api.post<CompRuleVersion>(`/owner/compensation/rules/${encodeURIComponent(id)}/versions`, { version }),
  approveVersion: (id: string) => api.post<CompRuleVersion>(`/owner/compensation/versions/${encodeURIComponent(id)}/approve`, {}),
  // activation prices every future line → the Super Admin commission authorization code (the server refuses without it)
  activateVersion: (id: string, adminAuthCode: string) => api.post<CompRuleVersion>(`/owner/compensation/versions/${encodeURIComponent(id)}/activate`, { adminAuthCode }),
  cancelVersion: (id: string) => api.post<CompRuleVersion>(`/owner/compensation/versions/${encodeURIComponent(id)}/cancel`, {}),
  tierPlans: () => api.get<TierPlan[]>('/owner/compensation/tier-plans'),
  createTierPlan: (body: { technicianId: string; mode: 'entire' | 'marginal'; bands: TierBand[] }) => api.post<TierPlan>('/owner/compensation/tier-plans', body as unknown as Record<string, unknown>),
  archiveTierPlan: (id: string) => api.post<{ ok: boolean }>(`/owner/compensation/tier-plans/${encodeURIComponent(id)}/archive`, {}),
  previewTierPlan: (body: { productionCents: number; bands: TierBand[] }) => api.post<TierPreview>('/owner/compensation/tier-plans/preview', body as unknown as Record<string, unknown>),
  retailPolicy: () => api.get<RetailPolicy>('/owner/compensation/retail-policy'),
  setRetailPolicy: (body: RetailPolicy) => api.put<RetailPolicy>('/owner/compensation/retail-policy', body as unknown as Record<string, unknown>),
  bonusRules: () => api.get<BonusRuleRow[]>('/owner/compensation/bonus-rules'),
  createBonusRule: (body: { metric: BonusMetric; target: number; amountCents: number; label?: string; technicianId?: string }) => api.post<BonusRuleRow>('/owner/compensation/bonus-rules', body as unknown as Record<string, unknown>),
  archiveBonusRule: (id: string) => api.post<{ ok: boolean }>(`/owner/compensation/bonus-rules/${encodeURIComponent(id)}/archive`, {}),
  previewBonuses: (body: { technicianId: string; fromIso: string; toIso: string }) => api.post<BonusPreview>('/owner/compensation/bonus-rules/preview', body as unknown as Record<string, unknown>),
  bonusPeriodReview: (periodId: string) => api.post<PeriodBonusReview>('/owner/compensation/bonus-rules/period-review', { periodId } as unknown as Record<string, unknown>),
  approveBonus: (body: { technicianId: string; periodId: string; amountCents: number; label?: string }) => api.post<{ ok: boolean; status: string; amountCents: number }>('/owner/compensation/bonus-rules/approve', body as unknown as Record<string, unknown>),
  classifications: () => api.get<ClassificationRow[]>('/owner/compensation/classifications'),
  setClassification: (technicianId: string, classification: WorkerClassification) => api.put<ClassificationRow>(`/owner/compensation/classifications/${encodeURIComponent(technicianId)}`, { classification } as unknown as Record<string, unknown>),
  wageConfig: () => api.get<WageConfig>('/owner/compensation/wage-config'),
  setWageConfig: (body: WageConfig) => api.put<WageConfig>('/owner/compensation/wage-config', body as unknown as Record<string, unknown>),
  compliancePreview: (body: { technicianId: string; periodPayCents: number; hoursWorked: number }) => api.post<CompliancePreview>('/owner/compensation/compliance-preview', body as unknown as Record<string, unknown>),
  compliancePeriodReview: (periodId: string) => api.post<PeriodComplianceRow[]>('/owner/compensation/compliance-period-review', { periodId } as unknown as Record<string, unknown>),
  agreements: (technicianId?: string) => api.get<Agreement[]>(`/owner/compensation/agreements${technicianId ? `?technicianId=${encodeURIComponent(technicianId)}` : ''}`),
  createAgreement: (body: { technicianId: string; title: string; terms: Record<string, unknown>; effectiveStart?: string }) => api.post<Agreement>('/owner/compensation/agreements', body as unknown as Record<string, unknown>),
};
export const ownerPayrollApi = {
  list: () => api.get<OwnerPayrollListResp>('/owner/payroll'),
  period: (id: string) => api.get<OwnerPayrollPeriodDetailResp>(`/owner/payroll/periods/${encodeURIComponent(id)}`),
  approve: (id: string, pin: string) => api.post<OwnerPayrollPeriodDetailResp>(`/owner/payroll/periods/${encodeURIComponent(id)}/approve`, { pin }),
  lock: (id: string, pin: string) => api.post<OwnerPayrollPeriodDetailResp>(`/owner/payroll/periods/${encodeURIComponent(id)}/lock`, { pin }),
  // Payroll wave 2 (§124): reopening an approved period needs a written reason (the engine refuses without one)
  reopen: (id: string, pin: string, reason: string) => api.post<OwnerPayrollPeriodDetailResp>(`/owner/payroll/periods/${encodeURIComponent(id)}/reopen`, { pin, reason }),
  // Weekly Paycheck (Oct 21 2026, §9): what the manager submitted — approve all / hold selected (PIN), return or reject (note)
  paycheckSummary: () => api.get<PaycheckOwnerSummary>('/owner/payroll/paychecks/summary'),
  // §66/§67: exceptions only · search a technician · one branch (the week's totals stay the whole week's)
  paycheckWeek: (id: string, f: { exceptionsOnly?: boolean; search?: string; branchId?: string } = {}) => {
    const q = new URLSearchParams(); if (f.exceptionsOnly) q.set('exceptionsOnly', '1'); if (f.search?.trim()) q.set('search', f.search.trim()); if (f.branchId) q.set('branchId', f.branchId);
    const qs = q.toString();
    return api.get<PaycheckWeek>(`/owner/payroll/paychecks/periods/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`);
  },
  paycheckApprove: (id: string, pin: string, body: { expectedVersion?: number; holdTechnicianIds?: string[] }) => api.post<PaycheckWeek>(`/owner/payroll/paychecks/periods/${encodeURIComponent(id)}/approve`, { pin, expectedVersion: body.expectedVersion ?? null, holdTechnicianIds: body.holdTechnicianIds ?? [] }),
  paycheckReturn: (id: string, note: string, expectedVersion?: number) => api.post<PaycheckWeek>(`/owner/payroll/paychecks/periods/${encodeURIComponent(id)}/return`, { note, expectedVersion: expectedVersion ?? null }),
  paycheckReject: (id: string, note: string, expectedVersion?: number) => api.post<PaycheckWeek>(`/owner/payroll/paychecks/periods/${encodeURIComponent(id)}/reject`, { note, expectedVersion: expectedVersion ?? null }),
  paycheckApproveHeld: (statementId: string, pin: string) => api.post<PayStatementDetail>(`/owner/payroll/paychecks/statements/${encodeURIComponent(statementId)}/approve`, { pin }),
  /** 17.5 (Oct 27 2026): an approved statement's pay stub — the PDF built from the locked snapshot, in the app's language */
  paycheckPayStub: (statementId: string, lang: string) => api.exportAsync<Blob>(`/owner/payroll/paychecks/statements/${encodeURIComponent(statementId)}/pay-stub.pdf`, { lang }, 'blob'),
  // Weekly Paycheck close-out (Oct 27 2026, §9.5): the evidence behind one statement — services, tips, hours, adjustments, payouts
  paycheckEvidence: (periodId: string, technicianId: string) => api.get<PayrollTechnicianDetail>(`/owner/payroll/paychecks/periods/${encodeURIComponent(periodId)}/technicians/${encodeURIComponent(technicianId)}/evidence`),
};

export interface OwnerCustomersOverviewResp {
  range: { from: string; to: string };
  kpis: OwnerCustomerKpis;
  loyalty: OwnerLoyaltyOverview;
  topSpenders: OwnerTopSpender[];
  generatedAt: string;
}
export interface OwnerGiftCardReportResp {
  range: { from: string; to: string };
  outstandingCents: number; activeCount: number; totalCards: number;
  issuedCents: number; issuedCount: number; redeemedCents: number; redeemedCount: number;
  generatedAt: string;
}
export const ownerCustomersApi = {
  overview: (period: OwnerPeriod, branchId?: string) => api.get<OwnerCustomersOverviewResp>('/owner/customers', { period, ...(branchId ? { branchId } : {}) }),
  giftCardReport: (period: OwnerPeriod, branchId?: string) => api.get<OwnerGiftCardReportResp>('/owner/gift-cards/report', { period, ...(branchId ? { branchId } : {}) }),
};

export interface OwnerInventoryOverviewResp {
  totalProducts: number; stockPositions: number;
  statusCounts: OwnerInventoryStatusCounts; needsReorderCount: number;
  stockValueCents: number | null; retailValueCents: number | null;
  brandsCount: number; vendorsCount: number; categoriesCount: number;
  topCategories: OwnerInventoryCategory[]; reorderList: OwnerInventoryReorderItem[];
  generatedAt: string;
}
export const ownerInventoryApi = {
  overview: (branchId?: string) => api.get<OwnerInventoryOverviewResp>('/owner/inventory', branchId ? { branchId } : {}),
};

export interface OwnerMarketingOverviewResp { kpis: OwnerMarketingKpis; channels: OwnerMarketingChannel[]; topCampaigns: OwnerMarketingCampaign[]; generatedAt: string }
export const ownerMarketingApi = {
  overview: (branchId?: string) => api.get<OwnerMarketingOverviewResp>('/owner/marketing', branchId ? { branchId } : {}),
};

export interface OwnerPaymentsOverviewResp {
  range: { from: string; to: string };
  summary: OwnerPaymentsSummary;
  transactions: OwnerPaymentTxn[];
  refunds: OwnerPaymentRefund[];
  generatedAt: string;
}
export const ownerPaymentsApi = {
  overview: (period: OwnerPeriod, branchId?: string) => api.get<OwnerPaymentsOverviewResp>('/owner/payments', { period, ...(branchId ? { branchId } : {}) }),
};

// ── AI Center (owner read surface; delegates to the canonical AI Center overview, which flags each metric honestly) ──
export interface AiMetric { tracked: boolean; value: number | null; unit?: string; source?: string; estimated?: boolean; route?: string }
export interface OwnerAiCenterResp {
  generatedAt: string;
  kpis: {
    aiCallsHandled: AiMetric; bookingsCapturedByAi: AiMetric; missedCallsRecovered: AiMetric;
    aiConversationsToday: AiMetric; automationSuccessRate: AiMetric; customerSentiment: AiMetric;
  };
  sections: { key: string; title: string; tracked: boolean; needs?: string }[];
  activity: { at: string; assistant: string; action: string; status: string }[];
  callIntelligence: { callsHandled: AiMetric; recovered: AiMetric; callToBookingRatePct: AiMetric };
  bookingAssistant: { completed: AiMetric; aiBookings: AiMetric; rebookings: AiMetric };
  automation: { sentToday: AiMetric; successRatePct: AiMetric };
  live: { appointmentsToday: AiMetric; aiBookingsToday: AiMetric; aiConversationsToday: AiMetric; customerSentiment: AiMetric; assistantsActive: AiMetric };
}
export const ownerAiCenterApi = {
  overview: (branchId?: string) => api.get<OwnerAiCenterResp>('/owner/ai-center', branchId ? { branchId } : {}),
};

export interface OwnerApprovalsResp {
  items: OwnerApprovalItem[];
  counts: { payrollToApprove: number; payrollToLock: number; openAlerts: number };
  generatedAt: string;
}
export const ownerApprovalsApi = {
  get: () => api.get<OwnerApprovalsResp>('/owner/approvals'),
};

// ── Home "Needs Attention" strip (owner; cross-module aggregate) ──
export interface OwnerAttentionResp {
  payrollToApprove: number; payrollToLock: number;
  lowStock: number; outOfStock: number;
  openAlerts: number;
  generatedAt: string;
}
export const ownerAttentionApi = {
  get: (branchId?: string) => api.get<OwnerAttentionResp>('/owner/attention', branchId ? { branchId } : {}),
};

// ── Memberships rollup (Owner) ──
export interface OwnerMembershipKpis {
  totalMembers: number; newMembersThisMonth: number; activeMembers: number; activePctOfTotal: number;
  membershipRevenueCents: number; revenueDeltaPct: number | null; expiringSoon: number; expiringWindowDays: number;
  canceledThisMonth: number; canceledDeltaPct: number | null;
}
export interface OwnerMembershipPlanSlice { planName: string; count: number; pct: number; revenueCents: number }
export interface OwnerMembershipStatusSlice { status: string; count: number; pct: number }
export interface OwnerMembershipOverview {
  kpis: OwnerMembershipKpis;
  planDistribution: OwnerMembershipPlanSlice[];
  statusBreakdown: OwnerMembershipStatusSlice[];
  rangeDays: number;
}
export const ownerMembershipsApi = {
  overview: (branchId?: string) => api.get<OwnerMembershipOverview>('/owner/memberships/overview', branchId ? { branchId } : undefined),
};

// ── Owner Access Code (security) ──
// Provisioning for the optional login second factor. status() reports whether one is set; setAccessCode() sets or
// rotates it, or removes it when newCode is blank. Both require an authenticated OWNER; changing it requires the
// current password (verified server-side). The plaintext code is never returned.
export interface OwnerSecurityStatus { accessCodeConfigured: boolean }
export const ownerSecurityApi = {
  status: () => api.get<OwnerSecurityStatus>('/owner/security'),
  setAccessCode: (currentPassword: string, newCode: string) =>
    api.post<{ ok: boolean; configured: boolean }>('/owner/security/access-code', { currentPassword, newCode }),
};
