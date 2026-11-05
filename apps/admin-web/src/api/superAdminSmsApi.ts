// superAdminSmsApi.ts — typed client for Super Admin → SMS Verification Packages (sms-packages P4).
// Backend: /super-admin/sms-packages (P1 CRUD) + /super-admin/sms-tenant-plan (P3 panel/assign/credit + §44 list).
// Money is integer cents on the wire, always — dollars exist only inside the input fields.
import { api } from './client';

export interface SmsPackage {
  id: string; code: string; name: string; description: string | null;
  monthlyPriceCents: number; includedVerificationCount: number;
  overageEnabled: boolean; overageUnitPriceCents: number;
  hardLimitEnabled: boolean; warningThresholdPercent: number; criticalThresholdPercent: number;
  selfServiceAvailable: boolean; active: boolean; displayOrder: number;
  tenantCount?: number; createdAt: string; updatedAt: string;
}

export interface TenantPlanRow {
  tenantId: string; tenantName: string; tenantStatus: string;
  packageName: string | null; packageCode: string | null; pendingChange: boolean;
  included: number | null; used: number | null; overage: number; failed: number;
  pctUsed: number | null; hardLimit: boolean;
  estimatedBillCents: number | null; cycleStart: string | null; cycleEnd: string | null; lastSmsAt: string | null;
}

export interface TenantPlanDetail {
  assignment: { packageId: string; packageName: string; packageCode: string; status: string; effectiveAt: string; customAllowance: number | null; pending: { packageId: string; packageName: string; effectiveAt: string } | null } | null;
  balance: { hasPackage: false } | { hasPackage: true; packageName: string; packageCode: string; cycleStart: string; cycleEnd: string; includedAllowance: number; usedIncluded: number; remainingIncluded: number; overageCount: number; overageUnitPriceCents: number; overageEnabled: boolean; hardLimitEnabled: boolean; failedCount: number; estimatedOverageCents: number };
  recentChanges: { changedAt: string; effectiveAt: string; reason: string; from: string | null; to: string; changedBy: string | null }[];
}

export interface ReconFinding {
  id: string; runDate: string; tenantId: string; tenantName: string; cycleId: string | null;
  findingType: string; details: Record<string, unknown>; updatedAt: string;
}

export interface SmsAnalytics {
  month: string;
  totals: { subscriptionRevenueCents: number; overageRevenueCents: number; costAvailable: boolean; providerCostCents: number | null; grossMarginCents: number | null; grossMarginPct: number | null };
  perPackage: { packageCode: string; packageName: string; tenants: number; subscriptionRevenueCents: number; overageRevenueCents: number; smsSent: number; smsFailed: number }[];
  byPurpose: { purpose: string; count: number }[];
  byStatus: { status: string; count: number }[];
}
export interface SmsChargesFeed {
  month: string; totalCents: number;
  tenants: { tenantId: string; tenantName: string; packageCode: string; baseCents: number; overageCents: number; totalCents: number }[];
}

export type SmsControls = Record<'sms.verification_platform_enabled' | 'sms.package_billing_enabled' | 'sms.new_tenant_enrollment_enabled' | 'sms.emergency_send_disabled', boolean>;

export const superAdminSmsApi = {
  getControls: () => api.get<SmsControls>('/super-admin/sms-packages/platform-controls'),
  getDefaultPackage: () => api.get<{ defaultPackageCode: string | null }>('/super-admin/sms-packages/default-package'),
  setDefaultPackage: (code: string | null, reason: string) => api.post<{ defaultPackageCode: string | null } | { ok: false; error: string; message?: string }>('/super-admin/sms-packages/default-package', { code, reason }),
  tenantUsage: (tenantId: string, limit = 10) => api.get<{ records: { requestedAt: string; purpose: string; category: string; status: string; billable: boolean; unitPriceCents: number; recipientMasked: string | null; hasSid: boolean }[] }>(`/super-admin/sms-tenant-plan/${tenantId}/usage`, { limit }),
  setControl: (key: string, enabled: boolean, reason: string) => api.post<SmsControls>('/super-admin/sms-packages/platform-controls', { key, enabled, reason }),
  analytics: (month?: string) => api.get<SmsAnalytics>('/super-admin/sms-tenant-plan/billing/analytics', month ? { month } : undefined),
  charges: (month?: string) => api.get<SmsChargesFeed>('/super-admin/sms-tenant-plan/billing/charges', month ? { month } : undefined),
  listPackages: () => api.get<{ packages: SmsPackage[] }>('/super-admin/sms-packages'),
  updatePackage: (id: string, patch: Record<string, unknown>) => api.patch<SmsPackage>(`/super-admin/sms-packages/${id}`, patch),
  setPackageActive: (id: string, active: boolean) => api.post<SmsPackage>(`/super-admin/sms-packages/${id}/${active ? 'enable' : 'disable'}`),
  listTenantPlans: () => api.get<{ tenants: TenantPlanRow[] }>('/super-admin/sms-tenant-plan'),
  tenantPlan: (tenantId: string) => api.get<TenantPlanDetail>(`/super-admin/sms-tenant-plan/${tenantId}`),
  assignPackage: (tenantId: string, body: { packageId: string; effective?: 'immediate' | 'next_cycle'; reason: string }) =>
    api.post<{ effective: string; effectiveAt: string } | { ok: false; error: string; message?: string }>(`/super-admin/sms-tenant-plan/${tenantId}/assign`, body),
  listFindings: () => api.get<{ findings: ReconFinding[] }>('/super-admin/sms-tenant-plan/reconciliation/findings'),
  resolveFinding: (findingId: string, disposition: 'resolved' | 'dismissed') =>
    api.post<{ ok: boolean }>(`/super-admin/sms-tenant-plan/reconciliation/findings/${findingId}/resolve`, { disposition }),
  addCredit: (tenantId: string, body: { amount: number; reason: string }) =>
    api.post<Record<string, unknown> | { ok: false; error: string; message?: string }>(`/super-admin/sms-tenant-plan/${tenantId}/credit`, body),
};
