// superAdminPlansApi.ts — typed client + hook for Super Admin → Plans & Feature Limits (GET /super-admin/plans/overview).
// Mirrors the backend plans-overview-core shape. Read-only; honest gaps are surfaced via kpis.notModeled.
import type { ChangePreview, GrandfatherRow, OverageRuleDetail, PlanDirectoryRow, PlansOverview, Strategy, TenantSubscription } from '@aipowersalon/api-contracts/platform';
export type { ChangePreview, GrandfatherRow, OverageRuleDetail, PlanDirectoryRow, PlansOverview, Strategy, TenantSubscription };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { useCallback, useEffect, useState } from 'react';
import { api } from './client';



export interface PlanVersion {
  id: string; versionNumber: number; monthlyPriceCents: number; annualPriceCents: number | null;
  status: string; effectiveFrom: string; endDate: string | null; changeReason: string | null; createdAt: string;
}

export interface CreatePlanBody {
  code: string; name: string; subtitle?: string | null; description?: string | null;
  planType?: string; status?: string;
  monthlyPriceCents: number; annualPriceCents?: number | null; setupFeeCents?: number;
  isRecommended?: boolean; isPublic?: boolean; displayOrder?: number;
  limits?: Record<string, number | null>;
  features?: { featureKey: string; state: string }[];
}

export interface ChangePricingBody {
  monthlyPriceCents: number; annualPriceCents?: number | null; reason: string; confirm: true; effectiveFrom?: string;
}


export type EntitlementLimit = {
  metric: string; planDefault: number | null; planConfigured: boolean;
  override: { value: number | null; enforcement: string; reason: string | null; expiresAt: string | null } | null;
  used: number | null; effectiveValue: number | null; effectiveSource: string; enforcement: string;
  evaluation: { status: string; usedPct: number | null };
};
export type EntitlementFeature = { featureKey: string; planState: string; override: string | null; enabled: boolean; source: string; blocked: boolean };
export type PlanUtilization = {
  generatedAt: string;
  summary: { tenants: number; tenantsNearLimit: number; tenantsOverLimit: number; avgMaxUtilizationPct: number };
  tenants: { tenantId: string; name: string; planText: string | null; planCode: string | null; maxPct: number; worstStatus: 'ok' | 'near' | 'over'; metrics: { metric: string; used: number; effective: number; pct: number; status: string }[] }[];
};
export type TenantEntitlements = {
  tenantId: string;
  plan: { text: string | null; mapped: boolean; code: string | null; name: string | null };
  limits: EntitlementLimit[];
  features: EntitlementFeature[];
};

export const superAdminPlansApi = {
  overview: () => api.get<PlansOverview>('/super-admin/plans/overview'),
  create: (body: CreatePlanBody) => api.post<{ id: string; versions: PlanVersion[] }>('/super-admin/plans', body as unknown as Record<string, unknown>),
  updateDetails: (id: string, body: Record<string, unknown>) => api.patch(`/super-admin/plans/${id}`, body),
  changePricing: (id: string, body: ChangePricingBody) => api.post<{ id: string; versionNumber: number; versions: PlanVersion[] }>(`/super-admin/plans/${id}/pricing`, body as unknown as Record<string, unknown>),
  updatePlanLimits: (id: string, body: { reason: string; changes: { metric: string; limitValue: number | null | 'unlimited'; enforcement?: 'hard' | 'soft'; overageAllowed?: boolean; overagePriceCents?: number }[] }) =>
    api.put(`/super-admin/plans/${id}/limits`, body as unknown as Record<string, unknown>),
  versions: (id: string) => api.get<PlanVersion[]>(`/super-admin/plans/${id}/versions`),
  previewChange: (tenantId: string, toPlanCode: string, strategy: Strategy) =>
    api.post<ChangePreview>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/subscription/preview`, { toPlanCode, strategy }),
  commitChange: (tenantId: string, toPlanCode: string, strategy: Strategy, reason: string) =>
    api.post<{ changeId: string; preview: ChangePreview }>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/subscription/change`, { toPlanCode, strategy, reason }),
  assignAddOn: (tenantId: string, addOnCode: string, quantity?: number, priceCents?: number | null) =>
    api.post<{ priceCents: number }>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/offers/add-ons`, { addOnCode, quantity, priceCents }),
  startTrial: (tenantId: string, trialCode: string) =>
    api.post<{ id: string; durationDays: number }>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/offers/trials`, { trialCode }),
  applyPromotion: (tenantId: string, promoCode: string) =>
    api.post<{ id: string }>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/offers/promotions`, { promoCode }),
  getEntitlements: (tenantId: string) => api.get<TenantEntitlements>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/entitlements`),
  setLimit: (tenantId: string, body: { metric: string; limitValue?: number | null | 'unlimited'; enforcement?: 'hard' | 'soft'; reason?: string; clear?: boolean }) =>
    api.put<TenantEntitlements>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/limits`, body),
  setFeature: (tenantId: string, body: { featureKey: string; state: 'enabled' | 'disabled' | 'clear'; reason?: string }) =>
    api.put<TenantEntitlements>(`/super-admin/plans/tenants/${encodeURIComponent(tenantId)}/features`, body),
  getOverageRules: () => api.get<OverageRuleDetail[]>('/super-admin/plans/overage/rules'),
  updateOverageRules: (body: { reason: string; changes: { metric: string; unitPriceCents: number; graceAmount?: number; warningThresholdPct?: number }[] }) =>
    api.put<OverageRuleDetail[]>('/super-admin/plans/overage/rules', body as unknown as Record<string, unknown>),
  recomputeOverage: () => api.post<{ period: string; tenantsProcessed: number; chargesWritten: number; totalRevenueCents: number }>('/super-admin/plans/overage/recompute', {}),
  listGrandfathered: () => api.get<GrandfatherRow[]>('/super-admin/plans/grandfathered'),
  createGrandfathered: (body: { tenantId: string; planVersionId: string; lockedMonthlyPriceCents?: number | null; migrationTargetPlanCode?: string | null; effectiveFrom?: string | null; endDate?: string | null; reason: string }) =>
    api.post<{ id: string; planCode: string; versionNumber: number; lockedMonthlyPriceCents: number }>('/super-admin/plans/grandfathered', body as unknown as Record<string, unknown>),
  planUtilization: () => api.get<PlanUtilization>('/super-admin/plans/utilization'),
};

export function usePlansOverview() {
  const [data, setData] = useState<PlansOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    superAdminPlansApi.overview()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e?.message || 'Failed to load plans'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}
