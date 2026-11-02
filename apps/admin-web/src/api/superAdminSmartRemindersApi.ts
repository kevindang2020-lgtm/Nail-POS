// superAdminSmartRemindersApi.ts — typed client for the Super Admin Smart Reminders oversight dashboard.
import { api } from './client';

export interface SRKpi { key: string; label: string; value: number; display: string; available: boolean; deltaPct: number; direction: 'up' | 'down' | 'flat'; semantic: 'good' | 'warn' | 'bad' | 'neutral' }
export interface SRSegment { key: string; label: string; count: number; pct: number }
export interface SRType { key: string; label: string; countAvailable: boolean }
export interface SRTrendDay { day: string; total: number; delivered: number; failed: number; blocked: number }
export interface SRTenantUsage { tenantId: string; tenant: string; total: number; delivered: number; failed: number; sms: number; email: number; push: number; deliveryRate: number }
export interface SRFailure { tenant: string; channel: string; reason: string; status: string; time: string }
export interface SRActivity { tenant: string; channel: string; status: string; time: string }
export interface SRPerf { tenant: string; delivered: number; deliveryRate: number; openRateAvailable: boolean; engagementAvailable: boolean }
export interface SROverview {
  ok: boolean;
  metadata: { generatedAt: string; windowDays: number };
  scope: { tenantId: string | null; label: string };
  kpis: SRKpi[];
  reminderTypes: SRType[];
  channelMix: { total: number; segments: SRSegment[] };
  deliveryStatus: { total: number; segments: SRSegment[]; pendingAvailable: boolean; fallbackAvailable: boolean };
  deliveryTrend: SRTrendDay[];
  scheduledVsDelivered: { days: { day: string; delivered: number; failed: number }[]; scheduledAvailable: boolean };
  tenantUsage: SRTenantUsage[];
  deliveryFailures: SRFailure[];
  recentActivity: SRActivity[];
  upcomingJobs: { available: boolean; jobs: unknown[] };
  performanceByTenant: SRPerf[];
  settings: { enabledFlows: number; customizations: number; avgLeadMinutes: number | null; tenantsUsing: number };
  atAGlance: { sentToday: number; successfulToday: number; failedToday: number; fallbackToday: { available: boolean }; avgOpenRate: { available: boolean }; tenantsUsingReminders: number };
}

export interface SRTemplateItem { id: string; tenant_id: string | null; reminder_type: string; name: string; status: string; current_version: number; versions: number }

export interface SRTiming { reminderType: string; direction: string; offsetMinutes: number; minOffsetMinutes: number; maxOffsetMinutes: number; signedOffset: number; quietHoursStart: number | null; quietHoursEnd: number | null; quietHoursLabel: string | null; quietHoursPolicy: string; timezoneSource: string; enabled: boolean; updatedAt: string }

export interface SREffective { tenantId: string; reminderType: string; platform: { direction: string; offsetMinutes: number; min: number; max: number } | null; override: { reminderType: string; enabled: boolean; direction: string | null; offsetMinutes: number | null; channels: string[] | null; quietHoursPolicy: string | null; approvalState: string } | null; effective: { enabled: boolean; direction: string; offsetMinutes: number; offsetSource: string; channels: string[] | null; quietHoursPolicy: string; allowedBand: { min: number; max: number } | null } }

export interface SRFlowState { reminderType: string; status: string; reason: string | null; disabledAt: string | null; updatedAt: string }

export interface SRChannelConfig { reminderType: string; primaryChannel: string; fallbackChannels: string[]; sequence: string[]; fallbackOn: string; maxFallbackAttempts: number; stopOnSuccess: boolean; recheckSuppression: boolean; recheckQuietHours: boolean }

export interface SRPlanFeature { planCode: string; featureKey: string; state: string; allowed: boolean; updatedAt: string }

export const superAdminSmartRemindersApi = {
  overview: (q?: Record<string, unknown>) => api.get<SROverview>('/super-admin/smart-reminders/overview', q),
  listTemplates: () => api.get<{ templates: SRTemplateItem[] }>('/super-admin/smart-reminders/templates'),
  createTemplate: (body: { name: string; reminderType: string; sms?: string; emailSubject?: string; emailBody?: string; pushTitle?: string; pushBody?: string }) => api.post<{ ok: boolean; id: string; version: number; status: string; reminderType: string; placeholders: string[] }>('/super-admin/smart-reminders/templates', body),
  publishTemplateVersion: (id: string, version: number) => api.post<{ ok: boolean; templateId: string; version: number; status: string; idempotent: boolean }>(`/super-admin/smart-reminders/templates/${id}/versions/${version}/publish`, {}),
  previewTemplate: (body: { sms?: string; emailBody?: string; pushBody?: string; values?: Record<string, string> }) => api.post<{ placeholders: string[]; sms: string | null; emailBody: string | null; pushBody: string | null }>('/super-admin/smart-reminders/templates/preview', body),
  getTiming: (reminderType: string) => api.get<{ reminderType: string; timing: SRTiming | null }>(`/super-admin/smart-reminders/timing/${reminderType}`),
  setTiming: (body: { reminderType: string; direction: string; offsetMinutes?: number; minOffsetMinutes: number; maxOffsetMinutes: number; quietHoursStart?: number | null; quietHoursEnd?: number | null; quietHoursPolicy: string; timezoneSource: string }) => api.post<{ ok: boolean; reminderType: string; before: SRTiming | null; after: SRTiming | null }>('/super-admin/smart-reminders/timing', body),
  getEffective: (tenantId: string, reminderType: string) => api.get<SREffective>(`/super-admin/smart-reminders/tenant-customizations/${tenantId}/${reminderType}/effective`),
  setOverride: (tenantId: string, body: { reminderType: string; enabled?: boolean; direction?: string; offsetMinutes?: number | null; channels?: string[]; quietHoursPolicy?: string }) => api.post<{ ok: boolean; tenantId: string; reminderType: string; effective: SREffective['effective'] }>(`/super-admin/smart-reminders/tenant-customizations/${tenantId}`, body),
  revertOverride: (tenantId: string, reminderType: string) => api.post<{ ok: boolean; reverted: boolean; effective: SREffective['effective'] }>(`/super-admin/smart-reminders/tenant-customizations/${tenantId}/${reminderType}/revert`, {}),
  getFlow: (reminderType: string) => api.get<{ reminderType: string; state: SRFlowState | null }>(`/super-admin/smart-reminders/flows/${reminderType}`),
  disableFlow: (body: { reminderType: string; reason: string; status?: string }) => api.post<{ ok: boolean; reminderType: string; status: string }>('/super-admin/smart-reminders/flows/disable', body),
  enableFlow: (body: { reminderType: string }) => api.post<{ ok: boolean; reminderType: string; status: string }>('/super-admin/smart-reminders/flows/enable', body),
  getChannels: (reminderType: string) => api.get<{ reminderType: string; config: SRChannelConfig | null }>(`/super-admin/smart-reminders/channels/${reminderType}`),
  setChannels: (body: { reminderType: string; primaryChannel: string; fallbackChannels: string[]; fallbackOn?: string; stopOnSuccess?: boolean }) => api.post<{ ok: boolean; reminderType: string; before: SRChannelConfig | null; after: SRChannelConfig | null }>('/super-admin/smart-reminders/channels', body),
  listPlanFeatures: (planCode?: string) => api.get<{ planCode: string | null; features: SRPlanFeature[] }>('/super-admin/smart-reminders/plan-features', planCode ? { planCode } : undefined),
  setPlanFeature: (body: { planCode: string; featureKey: string; state: string }) => api.post<{ ok: boolean; planCode: string; featureKey: string; state: string; allowed: boolean }>('/super-admin/smart-reminders/plan-features', body),
  exportCsv: (body: { dataset: string; tenantId?: string }) => api.post<{ ok: boolean; filename: string; mimeType: string; dataset: string; rowCount: number; content: string }>('/super-admin/smart-reminders/exports', body),
};
