// ownerApi.ts — Owner App API hooks over the shared fetch client. Pass 1: the Home dashboard. The server derives
// tenant + branch authorization from the session; only an optional selected branchId is ever sent (a real branch the
// session is allowed to view), never tenant context.
import { api } from './client';
import type { BonusMetric, BonusPreview, BonusRuleRow, ClassificationRow, CompliancePreview, DailyCashSummary, OwnerAlert, OwnerAlertSummary, OwnerAppointmentListItem, OwnerApprovalItem, OwnerAuditEntry, OwnerBookingOverview, OwnerBranchPerformanceState, OwnerContextResponse, OwnerCustomerKpis, OwnerDashboardState, OwnerDrawerSummary, OwnerExpense, OwnerExpenseInput, OwnerExpenseSummary, OwnerFinanceSummary, OwnerInventoryCategory, OwnerInventoryReorderItem, OwnerInventoryStatusCounts, OwnerLiveQueueRow, OwnerLiveTechRow, OwnerLoyaltyOverview, OwnerMarketingCampaign, OwnerMarketingChannel, OwnerMarketingKpis, OwnerPaymentMix, OwnerPaymentRefund, OwnerPaymentTxn, OwnerPaymentsSummary, OwnerPayrollKpis, OwnerPayrollLine, OwnerPayrollPeriodSummary, OwnerPeriod, OwnerProfileCard, OwnerReportExport, OwnerReportInfo, OwnerSalonOverview, OwnerSettingsSnapshot, OwnerStaffAttendance, OwnerStaffPerformanceState, OwnerTechnicianDetail, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTicketRow, OwnerTopSpender, PeriodBonusReview, PeriodComplianceRow, RetailPolicy, TierBand, WageConfig, WorkerClassification } from '@aipowersalon/api-contracts/tenant';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { BonusMetric, BonusPreview, BonusRuleRow, CashPoolSummary, ClassificationRow, ComplianceFlag, CompliancePreview, DailyCashSummary, EarnedBonus, OwnerAlert, OwnerAlertSeverity, OwnerAlertStatus, OwnerAlertSummary, OwnerAllowedBranch, OwnerAppointmentListItem, OwnerApprovalItem, OwnerAuditEntry, OwnerBookingOverview, OwnerBranchPerformanceState, OwnerContextResponse, OwnerCustomerKpis, OwnerDashboardState, OwnerDrawerRow, OwnerDrawerSummary, OwnerExpense, OwnerExpenseInput, OwnerExpenseSummary, OwnerFinanceSummary, OwnerInventoryCategory, OwnerInventoryReorderItem, OwnerInventoryStatusCounts, OwnerLiveQueueRow, OwnerLiveTechRow, OwnerLoyaltyOverview, OwnerLoyaltyTier, OwnerMarketingCampaign, OwnerMarketingChannel, OwnerMarketingKpis, OwnerPaymentMethod, OwnerPaymentMethodSlice, OwnerPaymentMix, OwnerPaymentRefund, OwnerPaymentTxn, OwnerPaymentsSummary, OwnerPayrollKpis, OwnerPayrollLine, OwnerPayrollPeriodStatus, OwnerPayrollPeriodSummary, OwnerPeriod, OwnerProfileCard, OwnerReportExport, OwnerReportInfo, OwnerSalonOverview, OwnerSettingsSnapshot, OwnerStaffAttendance, OwnerStaffPerformanceState, OwnerTechnicianDetail, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTicketRow, OwnerTopSpender, OwnerTopTechnician, PeriodBonusReview, PeriodBonusTech, PeriodComplianceRow, RetailMethod, RetailPolicy, TierBand, WageConfig, WorkerClassification } from '@aipowersalon/api-contracts/tenant';

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

// ---- Module 2: Branch Performance ----
export const ownerBranchesApi = {
  performance: (period: OwnerPeriod) => api.get<OwnerBranchPerformanceState>('/owner/branches/performance', { period }),
  comparison: (period: OwnerPeriod) => api.get<OwnerBranchPerformanceState>('/owner/branches/comparison', { period }),
};

// ---- Module 3: Booking Overview ----
export const ownerBookingsApi = {
  overview: (period: 'today' | 'week', branchId?: string) => api.get<OwnerBookingOverview>('/owner/bookings/overview', { period, ...(branchId ? { branchId } : {}) }),
  drillDown: (opts: { period?: 'today' | 'week'; status?: string; branchId?: string; limit?: number }) => api.get<OwnerAppointmentListItem[]>('/owner/bookings/drill-down', opts as Record<string, unknown>),
};

// ---- Ticket Oversight (read-only) — server scopes to the session's tenant + this owner's branches ----
export interface OwnerTicketListResp { tickets: OwnerTicketRow[]; total: number; page: number; pageSize: number; }
export interface OwnerTicketHistoryResp { ticket: OwnerTicketDetail; lines: OwnerTicketLine[]; revisions: OwnerTicketRevision[]; }

export const ownerTicketsApi = {
  list: (opts: { branchId?: string; status?: string; search?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number }) => api.get<OwnerTicketListResp>('/owner/tickets', opts as Record<string, unknown>),
  history: (id: string) => api.get<OwnerTicketHistoryResp>('/owner/tickets/' + encodeURIComponent(id) + '/history'),
};

// ---- Module 4: Staff / Technician Performance ----
export const ownerStaffApi = {
  performance: (period: OwnerPeriod, branchId?: string) => api.get<OwnerStaffPerformanceState>('/owner/staff/performance', { period, ...(branchId ? { branchId } : {}) }),
  attendance: (branchId?: string) => api.get<OwnerStaffAttendance>('/owner/staff/attendance', branchId ? { branchId } : undefined),
  technician: (technicianId: string, period: OwnerPeriod) => api.get<OwnerTechnicianDetail>(`/owner/staff/${technicianId}/performance`, { period }),
};

// ---- Module 5: Finance & Reports ----
export interface OwnerDateFilter { startDate?: string; endDate?: string }
export const ownerFinanceApi = {
  summary: (period: OwnerPeriod, branchId?: string, dates?: OwnerDateFilter) =>
    api.get<OwnerFinanceSummary>('/owner/finance/summary', {
      period,
      ...(branchId ? { branchId } : {}),
      ...(dates?.startDate ? { startDate: dates.startDate, from: dates.startDate } : {}),
      ...(dates?.endDate ? { endDate: dates.endDate, to: dates.endDate } : {}),
    }),
  paymentMix: (period: OwnerPeriod, branchId?: string, dates?: OwnerDateFilter) =>
    api.get<OwnerPaymentMix>('/owner/finance/payment-mix', {
      period,
      ...(branchId ? { branchId } : {}),
      ...(dates?.startDate ? { startDate: dates.startDate, from: dates.startDate } : {}),
      ...(dates?.endDate ? { endDate: dates.endDate, to: dates.endDate } : {}),
    }),
  reports: () => api.get<OwnerReportInfo[]>('/owner/reports'),
  export: (reportId: string, period: OwnerPeriod, branchId?: string, dates?: OwnerDateFilter) =>
    api.get<OwnerReportExport>(`/owner/reports/${reportId}/export`, {
      period,
      ...(branchId ? { branchId } : {}),
      ...(dates?.startDate ? { startDate: dates.startDate, from: dates.startDate } : {}),
      ...(dates?.endDate ? { endDate: dates.endDate, to: dates.endDate } : {}),
    }),
};

// ---- Module 6: Alerts / More / Settings ----
export const EXPENSE_CATEGORIES = ['rent', 'supplies', 'utilities', 'payroll', 'marketing', 'equipment', 'maintenance', 'insurance', 'software', 'other'] as const;
export const ownerExpensesApi = {
  list: (period: OwnerPeriod, branchId?: string, dateParams?: { startDate: string; endDate: string }) =>
    api.get<OwnerExpense[]>('/owner/expenses', { period, ...(branchId ? { branchId } : {}), ...(dateParams || {}) }),
  summary: (period: OwnerPeriod, branchId?: string, dateParams?: { startDate: string; endDate: string }) =>
    api.get<OwnerExpenseSummary>('/owner/expenses/summary', { period, ...(branchId ? { branchId } : {}), ...(dateParams || {}) }),
  create: (input: OwnerExpenseInput) => api.post<OwnerExpense>('/owner/expenses', input as unknown as Record<string, unknown>),
  update: (id: string, patch: Partial<OwnerExpenseInput>) => api.patch<OwnerExpense>(`/owner/expenses/${id}`, patch as Record<string, unknown>),
  remove: (id: string) => api.del<{ id: string; deleted: boolean }>(`/owner/expenses/${id}`),
};

export const ownerMoreApi = {
  profile: () => api.get<OwnerProfileCard>('/owner/profile'),
  uploadAvatar: async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload<{ url: string }>('/owner/profile/avatar', fd);   // the app transport: bearer on native, UPLOAD timeout
  },
  settings: () => api.get<OwnerSettingsSnapshot>('/owner/settings'),
  alerts: (opts?: { status?: string; severity?: string }) => api.get<OwnerAlert[]>('/owner/alerts', opts as Record<string, unknown> | undefined),
  alertSummary: () => api.get<OwnerAlertSummary>('/owner/alerts/summary'),
  acknowledge: (id: string) => api.post<OwnerAlert>(`/owner/alerts/${id}/acknowledge`),
  resolve: (id: string) => api.post<OwnerAlert>(`/owner/alerts/${id}/resolve`),
  dismiss: (id: string) => api.post<OwnerAlert>(`/owner/alerts/${id}/dismiss`),
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
  addMethod: (b: { gatewayPaymentMethodToken: string; brand?: string; last4?: string }) => api.post<any>('/owner/hardware-payment/payment-method', b),
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
  privacyExport: () => api.get<unknown>('/owner/me/privacy-export'),

  requestDeactivation: (reason?: string) => api.post<OwnerAccountRequestResult>('/owner/me/delete-account-request', reason ? { reason } : {}),
};

// Front-desk cash drawer — read-only owner oversight (per-branch register reconciliation, salon-wide).
export type OwnerDrawerStatus = 'open' | 'reconciled' | 'discrepancy' | 'cancelled';
export const ownerCashDrawerApi = {
  state: (date?: string) => api.get<OwnerDrawerSummary>('/owner/cash-drawer', date ? { date } : undefined),
};

// Daily cash close-out — combined register drawer + technician hand-offs (read-only owner position).
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

// ── Live Operations (owner monitoring of the live floor) ──
export interface OwnerLiveOperationsResp {
  branchId: string | null;
  counts: { waiting: number; serving: number; completedToday: number };
  techQueue: OwnerLiveTechRow[];
  liveQueue: OwnerLiveQueueRow[];
  todaySoFar: { servicesDone: number; walkIns: number };
  signals: { readyForCheckout: number; delayedAppointments: number };
  generatedAt: string;
}
export const ownerLiveApi = {
  get: (branchId?: string) => api.get<OwnerLiveOperationsResp>('/owner/live', branchId ? { branchId } : undefined),
};

// ── Commission & Payroll (owner read surface over the canonical compensation/payroll engine) ──
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
  activateVersion: (id: string) => api.post<CompRuleVersion>(`/owner/compensation/versions/${encodeURIComponent(id)}/activate`, {}),
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
  reopen: (id: string, pin: string) => api.post<OwnerPayrollPeriodDetailResp>(`/owner/payroll/periods/${encodeURIComponent(id)}/reopen`, { pin }),
};

// ── Customers & Loyalty (owner read surface) ──
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

// ── Inventory & Products (owner read surface) ──
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

// ── Marketing & Growth (owner read surface) ──
export interface OwnerMarketingOverviewResp { kpis: OwnerMarketingKpis; channels: OwnerMarketingChannel[]; topCampaigns: OwnerMarketingCampaign[]; generatedAt: string }
export const ownerMarketingApi = {
  overview: (branchId?: string) => api.get<OwnerMarketingOverviewResp>('/owner/marketing', branchId ? { branchId } : {}),
};

// ── Payments & Money (owner read surface) ──
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

// ── Approval Center (owner; aggregated pending actions) ──
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

export interface OwnerNotification { id: string; type: string; title: string; body: string | null; reference: string | null; readAt: string | null; createdAt: string; }
export interface OwnerNotificationsResult { unreadCount: number; items: OwnerNotification[]; }
export const ownerNotificationsApi = { get: () => api.get<OwnerNotificationsResult>('/owner/notifications'), markRead: () => api.post<{ ok: true }>('/owner/notifications/read') };
