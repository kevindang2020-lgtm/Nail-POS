import { api } from './client';
import type { ResidualReconcileResult, ResidualRevenueForecast, ResidualForecastPoint, ResidualForecastProjection } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export type RrKpis = {
  subscriptionRevenueCents: number; processingResidualsCents: number; monthlyRecurringRevenueCents: number; addOnRevenueCents: number;
  refundsCreditsCents: number; outstandingBalancesCents: number; forecastedRevenueCents: number; partnerPayoutsDueCents: number;
};
export type RrAgreement = {
  id: string; code: string; name: string; tenantId: string | null; tenantName: string | null; branchId: string | null; branchName: string | null;
  processor: string | null; revenueSource: string | null; status: string;
  aiPct: number | null; processorPct: number | null; salonPct: number | null; effectiveDate: string | null;
  monthlyRecurringRevenueCents: number; addOnRevenueCents: number; processingResidualsCents: number;
  refundsCreditsCents: number; netRevenueCents: number; outstandingBalanceCents: number; forecastedRevenueCents: number;
};
export type RrOverview = {
  available: boolean; generatedAt: string; kpis: RrKpis;
  revenueByProcessor: { totalCents: number; slices: { processor: string; amountCents: number; pct: number }[] };
  revenueSplitBreakdown: { totalCents: number; aiCents: number; processorCents: number; salonCents: number; aiPct: number; processorPct: number; salonPct: number };
  revenueTrend: { date: string; grossCents: number; netCents: number }[];
  recentActivity: { at: string | null; action: string; agreementCode: string | null; tenantId: string | null; amount: string | null; reason: string | null }[];
  outstandingBalances: { tenantId: string | null; amountCents: number; ageDays: number; lastActivity: string | null }[];
  forecastSummary: { grossCents: number; netCents: number; aiCents: number; processorCents: number; salonCents: number };
  selectedAgreement: RrAgreement | null;
};

export type RrRecordRow = {
  id: string; agreementCode: string | null; agreementId: string | null; tenantId: string | null; tenantName: string | null; branchId: string | null; branchName: string | null;
  processor: string | null; revenueSource: string | null; grossRevenueCents: number;
  aiPct: number | null; processorPct: number | null; salonPct: number | null;
  aiShareCents: number; processorShareCents: number; salonIncentiveShareCents: number;
  refundsCreditsCents: number; netRevenueCents: number; effectiveDate: string | null; status: string;
};
export type RrRecordsResult = { page: number; pageSize: number; total: number; rows: RrRecordRow[]; available: boolean };

export type RrRecordsQuery = {
  q?: string; agreementId?: string; tenantId?: string; branchId?: string; processor?: string;
  startDate?: string; endDate?: string; revenueType?: string; status?: string;
  page?: number; pageSize?: number; sort?: string; direction?: string;
};

export type RrExpenseCategory = { key: string; label: string; eligibleByDefault: boolean; note: string };

/** The eligible-expense catalog: which processor costs may be deducted BEFORE the residual split, and why. */
export function fetchExpenseCategories(): Promise<{ categories: RrExpenseCategory[] }> {
  return api.get<{ categories: RrExpenseCategory[] }>('/super-admin/revenue-residuals/expense-categories');
}
export function fetchRevenueOverview(agreementId?: string): Promise<RrOverview> {
  return api.get<RrOverview>('/super-admin/revenue-residuals/overview', agreementId ? { agreementId } : {});
}
export function listRevenueRecords(opts: RrRecordsQuery = {}): Promise<RrRecordsResult> {
  const query: Record<string, unknown> = { page: opts.page ?? 1, pageSize: opts.pageSize ?? 10 };
  for (const k of ['q', 'agreementId', 'tenantId', 'branchId', 'processor', 'startDate', 'endDate', 'revenueType', 'status', 'sort', 'direction'] as const) {
    if (opts[k]) query[k] = opts[k];
  }
  return api.get<RrRecordsResult>('/super-admin/revenue-residuals/records', query);
}
export function fetchRevenueAgreement(id: string): Promise<{ available: boolean; agreement: RrAgreement | null }> {
  return api.get<{ available: boolean; agreement: RrAgreement | null }>(`/super-admin/revenue-residuals/agreements/${id}`);
}

export type RrAgreementListItem = {
  id: string; code: string; name: string; tenantId: string | null; tenantName: string | null; branchId: string | null;
  processor: string | null; revenueSource: string | null; status: string;
  aiPct: number | null; processorPct: number | null; salonPct: number | null; effectiveDate: string | null; expirationDate: string | null; versionNumber: number | null;
};
export type RrVersion = {
  id: string; versionNumber: number; aiPct: number; processorPct: number; salonPct: number; effectiveDate: string | null; expirationDate: string | null;
  currency: string; roundingPolicy: string; refundAllocation: string; changeReason: string | null; createdAt: string | null; isCurrent: boolean;
};
export type NewAgreementInput = {
  name: string; agreementType?: string; tenantId?: string | null; branchId?: string | null; processor?: string | null; revenueSource?: string | null;
  aiPct: number; processorPct: number; salonPct: number; effectiveDate: string; expirationDate?: string | null; currency?: string;
  roundingPolicy?: string; refundAllocation?: string; status?: string; changeReason?: string;
};
export type NewVersionInput = {
  aiPct: number; processorPct: number; salonPct: number; effectiveDate: string; expirationDate?: string | null; currency?: string;
  roundingPolicy?: string; refundAllocation?: string; changeReason?: string;
};

export function listRevenueAgreements(opts: { q?: string; tenantId?: string; processor?: string; status?: string } = {}): Promise<{ available: boolean; agreements: RrAgreementListItem[] }> {
  const query: Record<string, unknown> = {};
  for (const k of ['q', 'tenantId', 'processor', 'status'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/agreements', query);
}
export function listAgreementVersions(id: string): Promise<{ available: boolean; versions: RrVersion[] }> {
  return api.get(`/super-admin/revenue-residuals/agreements/${id}/versions`);
}
export function createRevenueAgreement(input: NewAgreementInput): Promise<{ ok: boolean; id: string; code: string; versionId: string }> {
  return api.post('/super-admin/revenue-residuals/agreements', input);
}
export function addAgreementVersion(id: string, input: NewVersionInput): Promise<{ ok: boolean; versionId: string; versionNumber: number }> {
  return api.post(`/super-admin/revenue-residuals/agreements/${id}/versions`, input);
}

// ── Review Residual Statements ──
export type ResidualStatementListItem = {
  id: string; processor: string; statementRef: string; merchantAccount: string | null; tenantId: string | null; tenantName: string | null;
  periodStart: string; periodEnd: string; processingResidualCents: number; processorCalculatedCents: number;
  importStatus: string; reviewStatus: string; unmatchedLines: number; createdAt: string;
};
export type ResidualStatementLine = { id: string; merchantAccount: string | null; tenantId: string | null; grossVolumeCents: number; eligibleRevenueCents: number; residualCents: number; matched: boolean; agreementId: string | null; note: string | null };
export type ResidualStatementDetail = ResidualStatementListItem & {
  transactionVolumeCents: number; eligibleRevenueCents: number; feesCents: number; refundsCents: number; chargebacksCents: number; adjustmentsCents: number; reviewNotes: string | null; lines: ResidualStatementLine[];
};
export type ImportStatementInput = {
  processor: string; statementRef: string; merchantAccount?: string | null; tenantId?: string | null; branchId?: string | null;
  periodStart: string; periodEnd: string; currency?: string; transactionVolumeCents?: number; eligibleRevenueCents?: number;
  processingResidualCents?: number; feesCents?: number; refundsCents?: number; chargebacksCents?: number; adjustmentsCents?: number;
  processorCalculatedCents: number; sourceFile?: string | null;
  lines?: { merchantAccount?: string | null; tenantId?: string | null; grossVolumeCents?: number; eligibleRevenueCents?: number; residualCents?: number; note?: string | null }[];
};

export function listResidualStatements(opts: { processor?: string; tenantId?: string; reviewStatus?: string } = {}): Promise<{ available: boolean; statements: ResidualStatementListItem[] }> {
  const query: Record<string, unknown> = {};
  for (const k of ['processor', 'tenantId', 'reviewStatus'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/residual-statements', query);
}
export function fetchResidualStatement(id: string): Promise<{ available: boolean; statement: ResidualStatementDetail | null }> {
  return api.get(`/super-admin/revenue-residuals/residual-statements/${id}`);
}
export function importResidualStatement(input: ImportStatementInput): Promise<{ ok: boolean; imported: boolean; duplicate: boolean; statementId: string; linesImported: number; unmatchedLines: number }> {
  return api.post('/super-admin/revenue-residuals/residual-statements/import', input);
}
export function reviewResidualStatement(id: string, status: string, notes?: string): Promise<{ ok: boolean; reviewStatus: string }> {
  return api.post(`/super-admin/revenue-residuals/residual-statements/${id}/review`, { status, notes });
}

// ── Reconcile Processor Reports ──
export type ReconciliationItem = {
  id: string; statementId: string | null; statementRef: string | null; processor: string | null; tenantId: string | null; tenantName: string | null;
  periodStart: string | null; periodEnd: string | null; expectedAmountCents: number; actualAmountCents: number; differenceCents: number; differenceType: string; status: string;
  expectedAiCents: number; expectedProcessorCents: number; expectedSalonCents: number; createdAt: string | null;
};
export function reconcileStatement(id: string, notes?: string): Promise<ResidualReconcileResult> {
  return api.post(`/super-admin/revenue-residuals/residual-statements/${id}/reconcile`, notes ? { notes } : {});
}
export function listReconciliations(opts: { statementId?: string; status?: string } = {}): Promise<{ available: boolean; reconciliations: ReconciliationItem[] }> {
  const query: Record<string, unknown> = {};
  for (const k of ['statementId', 'status'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/reconciliations', query);
}

// ── Calculate Partner Payouts ──
export type PartnerPayoutResult = { ok: boolean; duplicate: boolean; payoutId: string; processor: string; eligibleRevenueCents: number; partnerPct: number; partnerGrossShareCents: number; refundAllocationCents: number; adjustmentAllocationCents: number; priorBalanceCents: number; amountDueCents: number; status: string; applicableCostsCents?: number; netPoolCents?: number; processorOwesPlatformCents?: number; platformOwesTenantCents?: number; platformRetainedCents?: number };
export type PartnerPayoutItem = {
  id: string; agreementId: string | null; agreementCode: string | null; processor: string; periodStart: string; periodEnd: string;
  eligibleRevenueCents: number; partnerPct: number | null; partnerGrossShareCents: number; refundAllocationCents: number; adjustmentAllocationCents: number; priorBalanceCents: number; amountPaidCents: number; amountDueCents: number; status: string; createdAt: string;
};
export function calculatePartnerPayout(input: { agreementId: string; periodStart: string; periodEnd: string; priorBalanceCents?: number }): Promise<PartnerPayoutResult> {
  return api.post('/super-admin/revenue-residuals/partner-payouts/calculate', input);
}
export function approvePartnerPayout(id: string): Promise<{ ok: boolean; status: string }> {
  return api.post(`/super-admin/revenue-residuals/partner-payouts/${id}/approve`, {});
}
export function listPartnerPayouts(opts: { processor?: string; agreementId?: string; status?: string } = {}): Promise<{ available: boolean; payouts: PartnerPayoutItem[] }> {
  const query: Record<string, unknown> = {};
  for (const k of ['processor', 'agreementId', 'status'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/partner-payouts', query);
}

// ── Calculate Tenant Incentives ──
export type TenantIncentiveResult = { ok: boolean; duplicate: boolean; incentiveId: string; eligibleGrossRevenueCents: number; salonPct: number; incentiveEarnedCents: number; refundAllocationCents: number; adjustmentAllocationCents: number; priorUnpaidBalanceCents: number; currentAmountDueCents: number; status: string; applicableCostsCents?: number; netPoolCents?: number; processorOwesPlatformCents?: number; platformRetainedCents?: number };
export type TenantIncentiveItem = {
  id: string; agreementId: string | null; agreementCode: string | null; tenantId: string | null; tenantName: string | null; periodStart: string; periodEnd: string;
  eligibleGrossRevenueCents: number; salonPct: number | null; incentiveEarnedCents: number; refundAllocationCents: number; adjustmentAllocationCents: number; priorUnpaidBalanceCents: number; amountPaidCents: number; currentAmountDueCents: number; status: string; createdAt: string;
};
export function calculateTenantIncentive(input: { agreementId: string; tenantId: string; periodStart: string; periodEnd: string; priorUnpaidBalanceCents?: number }): Promise<TenantIncentiveResult> {
  return api.post('/super-admin/revenue-residuals/tenant-incentives/calculate', input);
}
export function approveTenantIncentive(id: string): Promise<{ ok: boolean; status: string }> {
  return api.post(`/super-admin/revenue-residuals/tenant-incentives/${id}/approve`, {});
}
export function listTenantIncentives(opts: { tenantId?: string; agreementId?: string; status?: string } = {}): Promise<{ available: boolean; incentives: TenantIncentiveItem[] }> {
  const query: Record<string, unknown> = {};
  for (const k of ['tenantId', 'agreementId', 'status'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/tenant-incentives', query);
}

// ── Background export jobs ──
export type ExportJob = { id: string; dataset: string; format: string; status: 'queued' | 'running' | 'completed' | 'failed'; rowCount: number; filename: string | null; mime?: string | null; encoding?: string | null; content?: string | null; error: string | null; createdAt: string | null; completedAt: string | null };
export function enqueueExportJob(opts: ExportPayoutOpts = {}): Promise<{ ok: boolean; jobId: string; jobStatus: string }> {
  return api.post('/super-admin/revenue-residuals/export-jobs', opts);
}
export function listExportJobs(): Promise<{ available: boolean; jobs: ExportJob[] }> {
  return api.get('/super-admin/revenue-residuals/export-jobs', {});
}
export function getExportJob(id: string): Promise<{ available: boolean; job: ExportJob | null }> {
  return api.get(`/super-admin/revenue-residuals/export-jobs/${id}`, {});
}
export function downloadExportJobResult(job: ExportJob): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function' || !job.content) return;
  let body: BlobPart = job.content;
  if (job.encoding === 'base64' && typeof atob === 'function') {
    const bin = atob(job.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = bytes;
  }
  const blob = new Blob([body], { type: job.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = job.filename || 'revenue-export';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Revenue Forecast ──
export function getRevenueForecast(opts: { horizonMonths?: number } = {}): Promise<ResidualRevenueForecast> {
  const query: Record<string, unknown> = {};
  if (opts.horizonMonths) query.horizonMonths = opts.horizonMonths;
  return api.get('/super-admin/revenue-residuals/forecast', query);
}

// ── Track Unpaid Residuals ──
export type UnpaidResidualRow = { tenantId: string | null; tenantName: string | null; processor: string | null; agreementCount: number; outstandingCents: number; currentCents: number; b31_60Cents: number; b61_90Cents: number; b90PlusCents: number; oldestAgeDays: number };
export type UnpaidResidualTotals = { outstandingCents: number; currentCents: number; b31_60Cents: number; b61_90Cents: number; b90PlusCents: number };
export function getUnpaidResiduals(opts: { processor?: string; tenantId?: string } = {}): Promise<{ available: boolean; rows: UnpaidResidualRow[]; totals: UnpaidResidualTotals }> {
  const query: Record<string, unknown> = {};
  for (const k of ['processor', 'tenantId'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/unpaid-residuals', query);
}

// ── Lock Finalized Accounting Periods ──
export type AccountingPeriod = { id: string; name: string; startDate: string; endDate: string; currency: string; status: string; lockedAt: string | null; lockReason: string | null; reopenedAt: string | null; reopenReason: string | null };
export function listAccountingPeriods(opts: { status?: string } = {}): Promise<{ available: boolean; periods: AccountingPeriod[] }> {
  const query: Record<string, unknown> = {};
  if (opts.status) query.status = opts.status;
  return api.get('/super-admin/revenue-residuals/accounting-periods', query);
}
export function createAccountingPeriod(input: { name: string; startDate: string; endDate: string; currency?: string }): Promise<{ ok: boolean; periodId: string; status: string }> {
  return api.post('/super-admin/revenue-residuals/accounting-periods', input);
}
export function lockAccountingPeriod(id: string, reason?: string): Promise<{ ok: boolean; status: string; readiness: { unreviewedStatements: number; openVariances: number; pendingAdjustments: number } }> {
  return api.post(`/super-admin/revenue-residuals/accounting-periods/${id}/lock`, reason ? { reason } : {});
}
export function reopenAccountingPeriod(id: string, reason: string): Promise<{ ok: boolean; status: string }> {
  return api.post(`/super-admin/revenue-residuals/accounting-periods/${id}/reopen`, { reason });
}

// ── Approve Revenue Adjustments ──
export type AdjustmentItem = {
  id: string; adjustmentRef: string; agreementId: string | null; agreementCode: string | null; revenueRecordId: string | null; tenantId: string | null; tenantName: string | null;
  processor: string | null; adjustmentType: string; amountCents: number; direction: string; reason: string; requiresDualApproval: boolean; status: string; ledgerRecordId: string | null; createdAt: string;
};
export function listRevenueAdjustments(opts: { revenueRecordId?: string; agreementId?: string; status?: string } = {}): Promise<{ available: boolean; adjustments: AdjustmentItem[] }> {
  const query: Record<string, unknown> = {};
  for (const k of ['revenueRecordId', 'agreementId', 'status'] as const) if (opts[k]) query[k] = opts[k];
  return api.get('/super-admin/revenue-residuals/revenue-adjustments', query);
}
export function createRevenueAdjustment(input: { revenueRecordId?: string; agreementId?: string; accountingPeriodId?: string; tenantId?: string; branchId?: string; processor?: string; adjustmentType: string; amountCents: number; reason: string; supportingEvidence?: string }): Promise<{ ok: boolean; adjustmentId: string; ref: string; requiresDualApproval: boolean; status: string }> {
  return api.post('/super-admin/revenue-residuals/revenue-adjustments', input);
}
export function approveRevenueAdjustment(id: string): Promise<{ ok: boolean; status: string; needsSecondApproval?: boolean; ledgerRecordId?: string }> {
  return api.post(`/super-admin/revenue-residuals/revenue-adjustments/${id}/approve`, {});
}
export function rejectRevenueAdjustment(id: string, reason?: string): Promise<{ ok: boolean; status: string }> {
  return api.post(`/super-admin/revenue-residuals/revenue-adjustments/${id}/reject`, reason ? { reason } : {});
}
export function reverseRevenueAdjustment(id: string, reason?: string): Promise<{ ok: boolean; status: string; reversalLedgerId?: string }> {
  return api.post(`/super-admin/revenue-residuals/revenue-adjustments/${id}/reverse`, reason ? { reason } : {});
}
export type ExportPayoutOpts = { dataset?: 'records' | 'payouts' | 'incentives'; format?: 'csv' | 'xlsx' | 'pdf'; agreementId?: string; tenantId?: string; branchId?: string; processor?: string; revenueType?: string; status?: string; startDate?: string; endDate?: string };
export async function exportPayoutReports(opts: ExportPayoutOpts = {}): Promise<{ filename: string; rowCount: number }> {
  const query: Record<string, unknown> = {};
  for (const k of ['dataset', 'format', 'agreementId', 'tenantId', 'branchId', 'processor', 'revenueType', 'status', 'startDate', 'endDate'] as const) if (opts[k]) query[k] = opts[k];
  const res = await api.exportAsync<{ ok: boolean; filename: string; mime: string; content: string; rowCount: number; encoding?: 'utf8' | 'base64' }>('/super-admin/revenue-residuals/export', query);
  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    let body: BlobPart = res.content ?? '';
    if (res.encoding === 'base64' && typeof atob === 'function') {
      const bin = atob(res.content ?? '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      body = bytes;
    }
    const blob = new Blob([body], { type: res.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = res.filename || 'revenue-export';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { filename: res.filename, rowCount: res.rowCount };
}
export type { ResidualReconcileResult, ResidualRevenueForecast, ResidualForecastPoint, ResidualForecastProjection };
