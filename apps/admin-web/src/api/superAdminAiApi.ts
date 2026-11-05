// superAdminAiApi.ts — typed client for the Super-Admin AI subscription/usage surface (S13). Pulls the AI package
// catalog with real adoption roll-ups (GET /super-admin/ai/packages → packages + totals: subscribers, active, MRR) and
// the platform AI usage summary (GET /super-admin/ai/usage/summary). These are the genuinely-modelled AI surfaces;
// ML-style insights (forecasting, recommendations, anomaly detection, model confidence) are not implemented.
import { api } from './client';

export interface AdminAiPlanPkg { code: string; name: string; monthlyPriceCents: number; usageUnit: string }
export interface AdminAiPlan {
  code: string; name: string; description: string; essential: boolean; sortOrder: number;
  defaultFullCents: number; priceCentsOverride: number | null;
  discountType: 'percent' | 'flat' | null; discountValue: number;
  fullCents: number; discountCents: number; effectiveCents: number; active: boolean;
  annualMonths: number; yearlyPriceCents: number; annualSavingsCents: number;
  activeSubscribers: number; trialingSubscribers: number; mrrCents: number;
  packages: AdminAiPlanPkg[];
}

export interface AdminCopilotUsage { available: boolean; window: { from: string | null; to: string | null }; total: number; byAction: { action: string; count: number }[]; byTenant: { tenantId: string; count: number }[] }

export interface AdminTenantMessagingCreds { tenantId: string; provider: 'twilio'; status: 'not_configured' | 'configured'; accountSid: string | null; fromNumber: string | null; authTokenLast4: string | null }

export const superAdminAiApi = {
  catalog: () => api.get<any>('/super-admin/ai/packages'),
  tenantMessagingCreds: (tenantId: string) => api.get<AdminTenantMessagingCreds>(`/super-admin/tenants/${tenantId}/messaging-credentials`),
  setTenantMessagingCreds: (tenantId: string, body: { accountSid: string; authToken?: string; fromNumber: string }) => api.put<AdminTenantMessagingCreds>(`/super-admin/tenants/${tenantId}/messaging-credentials`, body),
  testTenantMessaging: (tenantId: string, to: string) => api.post<{ ok: boolean; sid?: string; error?: string; reason?: string }>(`/super-admin/tenants/${tenantId}/messaging-credentials/test`, { to }),
  numberGet: (tenantId: string) => api.get<{ configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null }>(`/super-admin/tenants/${tenantId}/number`),
  numberSearch: (tenantId: string, areaCode: string) => api.get<{ available: { phoneNumber: string; friendlyName: string; locality: string | null; region: string | null }[]; configured: boolean }>(`/super-admin/tenants/${tenantId}/number/search`, areaCode ? { areaCode } : undefined),
  numberBuy: (tenantId: string, phoneNumber: string) => api.post<{ ok: boolean; number?: string; error?: string; reason?: string }>(`/super-admin/tenants/${tenantId}/number/buy`, { phoneNumber }),
  numberRegister: (tenantId: string, phoneNumber: string) => api.post<{ ok: boolean; number?: string; error?: string }>(`/super-admin/tenants/${tenantId}/number/register`, { phoneNumber }),
  a2pGet: (tenantId: string) => api.get<any>(`/super-admin/tenants/${tenantId}/a2p`),
  a2pSaveInputs: (tenantId: string, body: any) => api.put<any>(`/super-admin/tenants/${tenantId}/a2p/inputs`, body),
  a2pSaveBusinessInfo: (tenantId: string, body: any) => api.put<any>(`/super-admin/tenants/${tenantId}/a2p/business-info`, body),
  a2pProvisionProfile: (tenantId: string) => api.post<any>(`/super-admin/tenants/${tenantId}/a2p/provision-profile`, {}),
  a2pSubmitBrand: (tenantId: string) => api.post<any>(`/super-admin/tenants/${tenantId}/a2p/brand`, {}),
  a2pSubmitCampaign: (tenantId: string) => api.post<any>(`/super-admin/tenants/${tenantId}/a2p/campaign`, {}),
  a2pAttachNumber: (tenantId: string, phoneNumberSid: string) => api.post<any>(`/super-admin/tenants/${tenantId}/a2p/number`, { phoneNumberSid }),
  a2pRefresh: (tenantId: string) => api.post<any>(`/super-admin/tenants/${tenantId}/a2p/refresh`, {}),
  messagingReadiness: () => api.get<{
    overall: string;
    checks: { key: string; label: string; ok: boolean; required: boolean; detail: string }[];
    webhooks: { inbound: string; status: string };
    // Can this platform actually DELIVER an invitation? `smsFromEnv()` falls back to a Mock when unset — SMS
    // silently does nothing, everywhere, and the only place it surfaced was inside a single hire.
    invitations: {
      status: 'ready' | 'partial' | 'not_connected';
      canSendSms: boolean; canSendEmail: boolean; hasNotifierFallback: boolean; hasAcceptUrl: boolean;
      consequence: string; blockers: string[];
    };
  }>('/super-admin/messaging/readiness'),
  aiReadiness: () => api.get<{ overall: string; provider: string | null; draftsPolished: boolean; checks: { key: string; label: string; ok: boolean; detail: string }[]; copilotPackage: { code: string; name: string; available: boolean } }>('/super-admin/ai/readiness'),
  aiBookingMetrics: (tenantId: string, sinceDays?: number) => api.get<{ overall: { searches: number; attempts: number; successes: number; failures: number; handoffs: number; bookingConversionRate: number; searchToBookingRate: number }; bySource: { source: string; searches: number; attempts: number; successes: number; failures: number; handoffs: number; bookingConversionRate: number; searchToBookingRate: number }[]; failureReasons: { reason: string; count: number }[] }>(`/super-admin/tenants/${tenantId}/ai-booking/metrics`, sinceDays ? { sinceDays } : undefined),
  copilotUsage: () => api.get<AdminCopilotUsage>('/super-admin/copilot/usage'),
  usageSummary: () => api.get<any>('/super-admin/ai/usage/summary'),
  usageStats: () => api.get<any>('/super-admin/ai/usage/stats'),
  plans: () => api.get<{ plans: AdminAiPlan[] }>('/super-admin/ai-plans'),
  updatePlan: (code: string, body: { priceCentsOverride?: number | null; discountType?: 'percent' | 'flat' | null; discountValue?: number; active?: boolean; annualMonths?: number }) =>
    api.patch<any>(`/super-admin/ai-plans/${code}`, body),
  tenantPlans: (tenantId: string) => api.get<{ tenantId: string; plans: { code: string; name: string; status: string | null; priceCents: number | null; billingPeriod: 'monthly' | 'yearly' | null; trialEndsAt: string | null }[] }>(`/super-admin/ai-plans/tenant/${tenantId}`),
  assignPlan: (code: string, tenantId: string, trial = false, billingPeriod: 'monthly' | 'yearly' = 'monthly') => api.post<any>(`/super-admin/ai-plans/${code}/assign`, { tenantId, trial, billingPeriod }),
  convertPlan: (code: string, tenantId: string, billingPeriod?: 'monthly' | 'yearly') => api.post<any>(`/super-admin/ai-plans/${code}/convert`, { tenantId, billingPeriod }),
  convertExpiredTrials: () => api.post<{ ok: boolean; converted: number }>(`/super-admin/ai-plans/convert-expired-trials`, {}),
  unassignPlan: (code: string, tenantId: string) => api.patch<any>(`/super-admin/ai-plans/${code}/unassign`, { tenantId }),
  // AI Business Assistant adoption (platform aggregates; SuperAdminGuard). Counts only — no tenant drilldown.
  aiBusinessOverview: () => api.get<AdminAiBusinessOverview>(`/super-admin/ai-business/overview`),
};

export interface AdminAiBusinessOverview {
  savedQuestions: { total: number; tenants: number; byIntent: { intent: string; count: number }[] };
  alerts: { total: number; active: number; tenants: number; byMetric: { metricId: string; count: number }[] };
}
