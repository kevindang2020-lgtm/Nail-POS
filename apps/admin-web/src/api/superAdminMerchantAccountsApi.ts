import { api } from './client';
import type { Semantic } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

// superAdminMerchantAccountsApi — Super Admin → Payments & Revenue → Merchant Accounts (read spine). Mirrors the live
// aggregate at GET /super-admin/merchant-accounts/overview. Every section carries honest availability so the UI can
// render real values / "—" / "Not yet provisioned" instead of fabricated data. Only Fiserv/CardPointe/Clover surface.


export interface MAKpi { key: string; label: string; value: number; display: string; available: boolean; href: string | null; semantic: Semantic }
export interface MASegment { key: string; label: string; count: number; pct: number }
export interface MAStage { key: string; label: string; count: number }

export interface MAMerchantRow {
  tenantId: string; merchantId: string; processor: string; processorLabel: string; tenant: string; branch: string;
  legalBusinessName: string;
  processingStatus: string; processingStatusLabel: string; processingSemantic: Semantic;
  underwritingStatus: string; underwritingStatusLabel: string; underwritingSemantic: Semantic;
  bankVerification: string; bankVerificationLabel: string; bankVerificationSemantic: Semantic; bankVerificationAvailable: boolean;
  pricingPlan: string; pricingPlanAvailable: boolean;
  processingRates: string; processingRatesAvailable: boolean;
  terminalAssignments: number;
  applicationStatus: string; applicationStatusLabel: string;
  riskStatus: string; riskStatusLabel: string; riskStatusAvailable: boolean;
  fundingSchedule: string; fundingScheduleLabel: string; fundingScheduleAvailable: boolean;
  environment: string;
}
export interface MASelectedMerchant extends MAMerchantRow { funding: MAFunding }
export interface MAActivityRow { time: string; merchantId: string; activity: string; user: string }
export interface MAHighRiskRow { merchantId: string; tenant: string; riskStatus: string; riskLabel: string; reviewedAt: string }
export interface MAFundingIssue { key: string; label: string; count: number; pct: number }
export interface MAAlertRow { id: string; merchantId: string; tenant: string; alertType: string; severity: string; severityLabel: string; severitySemantic: Semantic; summary: string; status: string; reviewer: string | null; createdAt: string }
export type MAFunding =
  | { available: false; note: string }
  | { available: true; bankAccount: string; bankName: string; accountType: string; bankVerificationLabel: string; note: string };

export interface MAOverview {
  ok: boolean;
  metadata: { generatedAt: string };
  scope: { tenantId: string | null; label: string };
  kpis: MAKpi[];
  merchants: MAMerchantRow[];
  merchantsTotal: number;
  selectedMerchant: MASelectedMerchant | null;
  processorDistribution: { total: number; segments: MASegment[] };
  underwritingPipeline: { stages: MAStage[] };
  merchantStatusBreakdown: { total: number; segments: MASegment[] };
  terminalAssignmentOverview: { total: number; segments: MASegment[] };
  recentActivity: MAActivityRow[];
  alerts: { available: boolean; total: number; items: MAAlertRow[] };
  topFundingIssues: { available: boolean; total: number; items: MAFundingIssue[] };
  highRiskAccounts: { available: boolean; total: number; items: MAHighRiskRow[] };
}

export interface MAListResponse {
  ok: boolean; scope: { tenantId: string | null; label: string };
  page: number; pageSize: number; total: number; rows: MAMerchantRow[];
}

export type MAQuery = {
  tenantId?: string; selected?: string; search?: string; processor?: string; underwritingStatus?: string;
  processingStatus?: string; riskStatus?: string; fundingSchedule?: string; page?: number; pageSize?: number;
};

export interface MAConfigureRatesBody { percentageBasisPoints: number; perTxnFeeMinor: number; monthlyFeeMinor?: number; refundFeeMinor?: number; chargebackFeeMinor?: number; pricingPlanId?: string; effectiveAt?: string; changeReason: string }
export interface MAConfigureRatesResult { ok: boolean; idempotent: boolean; scheduleId: string; before: { display: string } | null; after: { display: string }; effectiveAt: string }

export interface MARequirement { key: string; label: string; met: boolean }
export interface MAStatusResult { ok: boolean; blocked: boolean; action: string; status: string; requirements?: MARequirement[]; blockers?: MARequirement[]; impact?: { currentStatus: string; assignedTerminals: number } }

export interface MAFundingUpdateBody { stepUpConfirmed: boolean; accountNumber: string; routingNumber: string; bankName?: string; accountType?: string; fundingSchedule?: string; reason: string }
export interface MAFundingUpdateResult { ok: boolean; profileId: string; before: { bankAccount: string; bankName: string } | null; after: { bankAccount: string; bankName: string; accountType: string; bankVerification: string }; verificationStatus: string; note: string }

export interface MAMidAssignResult { ok: boolean; idempotent: boolean; merchantId: string; previousMid: string | null; branchId: string | null }

export interface MATerminalAssignResult { ok: boolean; idempotent: boolean; terminalId: string; previousBranchId: string | null; branchId: string; label: string | null }

export interface MAExportResult { ok: boolean; filename: string; mimeType: string; rowCount: number; csv: string; formats: { csv: boolean; xlsx: boolean; pdf: boolean } }

export const superAdminMerchantAccountsApi = {
  overview: (q?: MAQuery) => api.get<MAOverview>('/super-admin/merchant-accounts/overview', q as Record<string, unknown> | undefined),
  list: (q?: MAQuery) => api.get<MAListResponse>('/super-admin/merchant-accounts', q as Record<string, unknown> | undefined),
  exportReport: (q?: MAQuery) => api.exportAsync<MAExportResult>('/super-admin/merchant-accounts/export', q as Record<string, unknown> | undefined),
  configureRates: (tenantId: string, body: MAConfigureRatesBody) => api.post<MAConfigureRatesResult>(`/super-admin/merchant-accounts/${tenantId}/rates`, body as unknown as Record<string, unknown>),
  activate: (tenantId: string, reason: string) => api.post<MAStatusResult>(`/super-admin/merchant-accounts/${tenantId}/activation`, { reason }),
  deactivate: (tenantId: string, reason: string) => api.post<MAStatusResult>(`/super-admin/merchant-accounts/${tenantId}/deactivation`, { reason }),
  updateFunding: (tenantId: string, body: MAFundingUpdateBody) => api.post<MAFundingUpdateResult>(`/super-admin/merchant-accounts/${tenantId}/funding-update`, body as unknown as Record<string, unknown>),
  assignMid: (tenantId: string, body: { merchantId: string; branchId?: string; reason: string }) => api.post<MAMidAssignResult>(`/super-admin/merchant-accounts/${tenantId}/mid-assignment`, body),
  assignTerminal: (tenantId: string, body: { terminalId: string; branchId: string; reason: string }) => api.post<MATerminalAssignResult>(`/super-admin/merchant-accounts/${tenantId}/terminals`, body),
};
export type { Semantic };
