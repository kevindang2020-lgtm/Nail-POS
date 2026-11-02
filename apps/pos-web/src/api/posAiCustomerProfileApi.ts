// posAiCustomerProfileApi.ts — typed client for the AI Customer Profile Assistant (Stages 1–3).
// Read-only intelligence + the confirmed duplicate-merge action. Tenant/branch are server-derived — never sent.
import { api } from './client';

const enc = encodeURIComponent;

export const posAiCustomerProfileApi = {
  // per-customer reads
  overview: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/overview`),
  visitSummary: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/visit-summary`),
  servicePreferences: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/service-preferences`),
  technicianPreference: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/technician-preference`),
  inactivity: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/inactivity`),
  completeness: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/completeness`),
  churn: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/churn`),
  recommendations: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/recommendations`),
  rebooking: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/rebooking`),
  timeline: (id: string, opts: { limit?: number; before?: string | null } = {}) =>
    api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/timeline`, {
      ...(opts.limit ? { limit: String(opts.limit) } : {}),
      ...(opts.before ? { before: opts.before } : {}),
    }),
  copilotContext: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/copilot-context`),
  callSummary: (id: string) => api.get<any>(`/pos/ai-customer-profile/customers/${enc(id)}/call-summary`),

  // tenant-wide
  tenantOverview: () => api.get<any>(`/pos/ai-customer-profile/tenant-overview`),
  refreshTenantOverview: () => api.post<any>(`/pos/ai-customer-profile/tenant-overview/refresh`),
  duplicates: () => api.get<any>(`/pos/ai-customer-profile/duplicates`),
  settings: () => api.get<any>(`/pos/ai-customer-profile/settings`),
  updateSettings: (level: 'tenant' | 'branch' | 'user', patch: { enabled?: boolean; tunables?: any }) =>
    api.put<any>(`/pos/ai-customer-profile/settings/${level}`, patch),

  // duplicate merge: preview (read-only) then confirmed execution (mutation)
  mergePreview: (groupId: string, primaryCustomerId: string) =>
    api.get<any>(`/pos/ai-customer-profile/duplicates/${enc(groupId)}/preview`, { primary: primaryCustomerId }),
  merge: (groupId: string, primaryCustomerId: string) =>
    api.post<any>(`/pos/ai-customer-profile/duplicates/${enc(groupId)}/merge`, { primaryCustomerId, confirm: true }),
};
