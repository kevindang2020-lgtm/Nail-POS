// superAdminCommunicationsApi.ts — typed client for the Super-Admin cross-tenant Communications inbox (S12). Pulls the
// platform inbox state (GET /super-admin/communications/state → thread KPIs + channel breakdown + thread rows) under
// the server-side SuperAdminGuard. Channels are sms/email/call (the platform's modelled comms surfaces).
import { api } from './client';

export interface CommKpi { key: string; label: string; value: number; display: string; available: boolean; deltaPct: number; direction: 'up' | 'down' | 'flat'; semantic: 'good' | 'warn' | 'bad' | 'neutral'; href: string | null }
export interface CommSegment { key: string; label: string; count: number; pct: number }
export interface CommType { key: string; label: string; sent: number; delivered: number; deliveryRate: number }
export interface CommProviderRow { provider: string; key: string; label: string; semantic: string; delivered: number; failed: number }
export interface CommTrendDay { day: string; sent: number; delivered: number; failed: number; suppressed: number }
export interface CommTenantUsage { tenantId: string; tenant: string; sent: number; delivered: number; failed: number; deliveryRate: number; optOuts: number; optOutRate: number }
export interface CommFailure { tenant: string; channel: string; template: string; reason: string; provider: string; time: string }
export interface CommActivity { template: string; channel: string; sent: number; delivered: number; tenants: number }
export interface CommOverview {
  ok: boolean;
  metadata: { generatedAt: string; windowDays: number };
  scope: { tenantId: string | null; label: string };
  kpis: CommKpi[];
  communicationMix: { total: number; segments: CommSegment[] };
  communicationTypes: CommType[];
  providerStatus: { total: number; segments: CommSegment[]; providers: CommProviderRow[] };
  volumeTrend: CommTrendDay[];
  deliveryPerformance: CommTrendDay[];
  tenantUsage: CommTenantUsage[];
  deliveryFailures: CommFailure[];
  topActivity: CommActivity[];
  templates: { total: number };
  atAGlance: { sms: number; email: number; push: number; inApp: number; avgDeliveryRate: number; providerIncidents: { available: boolean } };
}

export interface CreateAnnouncementBody { title: string; subject?: string; body: string; channel: string; priority: string; recipientRoles: string[]; targetScope?: string; targetTenantIds?: string[]; scheduledAt?: string; idempotencyKey?: string }
export interface CreateAnnouncementResult { ok: boolean; idempotent: boolean; id: string; recipientEstimate: number; status: string }

export interface TenantLimit { monthlySms: number | null; monthlyEmail: number | null; monthlyPush: number | null; dailyLimit: number | null; enforcement: string; optOutRateThresholdBps: number | null; failureRateThresholdBps: number | null; status: string; updatedAt: string }
export interface TenantLimitResult { tenantId: string; limit: TenantLimit | null; usage: { sms: number; email: number; push: number; total: number }; limitUsed: { sms: number | null; email: number | null; push: number | null } | null; available: boolean }
export interface SetLimitBody { monthlySms?: number | null; monthlyEmail?: number | null; monthlyPush?: number | null; dailyLimit?: number | null; enforcement: string; optOutRateThresholdBps?: number | null; status?: string }

export interface TemplateListItem { id: string; tenant_id: string | null; name: string; channel: string; category: string | null; status: string; current_version: number; versions: number }
export interface TemplateVersionItem { id: string; version: number; subject: string | null; body: string; push_title: string | null; placeholders: string[]; status: string; published_at: string | null }

export interface CommProviderItem { id: string; name: string; channel: string; region: string | null; api_endpoint: string | null; status: string; priority: number; credential_last4: string | null; last_health_check_at: string | null }

export const superAdminCommunicationsApi = {
  getState: (q?: Record<string, unknown>) => api.get<any>('/super-admin/communications/state', q),
  overview: (q?: Record<string, unknown>) => api.get<CommOverview>('/super-admin/communications/overview', q),
  createAnnouncement: (body: CreateAnnouncementBody) => api.post<CreateAnnouncementResult>('/super-admin/communications/announcements', body as unknown as Record<string, unknown>),
  getTenantLimit: (tenantId: string) => api.get<TenantLimitResult>(`/super-admin/communications/tenants/${tenantId}/limits`),
  setTenantLimit: (tenantId: string, body: SetLimitBody) => api.post<{ ok: boolean; tenantId: string; before: TenantLimit | null; after: TenantLimit | null }>(`/super-admin/communications/tenants/${tenantId}/limits`, body as unknown as Record<string, unknown>),
  listTemplates: () => api.get<{ templates: TemplateListItem[] }>('/super-admin/communications/templates'),
  createTemplate: (body: { name: string; channel: string; body: string; subject?: string; category?: string }) => api.post<{ ok: boolean; id: string; version: number; status: string; placeholders: string[] }>('/super-admin/communications/templates', body),
  publishTemplateVersion: (id: string, version: number) => api.post<{ ok: boolean; templateId: string; version: number; status: string; idempotent: boolean }>(`/super-admin/communications/templates/${id}/versions/${version}/publish`, {}),
  previewTemplate: (body: { body: string; values?: Record<string, string> }) => api.post<{ rendered: string; placeholders: string[] }>('/super-admin/communications/templates/preview', body),
  listProviders: () => api.get<{ providers: CommProviderItem[] }>('/super-admin/communications/providers'),
  createProvider: (body: { name: string; channel: string; credential: string; apiEndpoint?: string; region?: string }) => api.post<{ ok: boolean; id: string; status: string }>('/super-admin/communications/providers', body),
  testProvider: (id: string) => api.post<{ ok: boolean; id: string; credentialValid: boolean; health: string; healthLabel: string; recent: { delivered: number; failed: number }; status: string }>(`/super-admin/communications/providers/${id}/test`, {}),
};
