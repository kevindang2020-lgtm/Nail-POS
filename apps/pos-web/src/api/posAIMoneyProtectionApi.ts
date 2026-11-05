// posAIMoneyProtectionApi.ts — AI Money Protection (read + advisory + investigation). Tenant/branch are
// server-derived from the session; the client never sends a tenantId. Detection/mutation of money never happens
// here — these endpoints only read alerts, request an advisory explanation, and manage investigations.
import { api } from './client';

export const posAIMoneyProtectionApi = {
  state: () => api.get(`/pos/ai-money-protection/state`),
  rules: () => api.get(`/pos/ai-money-protection/rules`),
  getSettings: () => api.get(`/pos/ai-money-protection/settings`),
  updateSetting: (ruleId: string, body: Record<string, unknown>) => api.post(`/pos/ai-money-protection/settings/${ruleId}`, body),
  alerts: (q: Record<string, string | number | undefined> = {}) => {
    const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get(`/pos/ai-money-protection/alerts${qs ? `?${qs}` : ''}`);
  },
  // Advisory AI explanation of a single alert (sanitized server-side; never accusatory).
  explainAlert: (id: string) => api.post(`/pos/ai-money-protection/alerts/${id}/explain`, {}),
  listInvestigations: (q: Record<string, string | undefined> = {}) => {
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return api.get(`/pos/ai-money-protection/investigations${qs ? `?${qs}` : ''}`);
  },
  getInvestigation: (id: string) => api.get(`/pos/ai-money-protection/investigations/${id}`),
  createInvestigation: (body: Record<string, unknown>) => api.post(`/pos/ai-money-protection/investigations`, body),
  addNote: (id: string, body: string) => api.post(`/pos/ai-money-protection/investigations/${id}/notes`, { body }),
  assignInvestigation: (id: string, assigneeUserId: string) => api.post(`/pos/ai-money-protection/investigations/${id}/assign`, { assigneeUserId }),
  setInvestigationStatus: (id: string, status: string) => api.post(`/pos/ai-money-protection/investigations/${id}/status`, { status }),
  resolveInvestigation: (id: string, resolution: string, recoveryAmountCents?: number) => api.post(`/pos/ai-money-protection/investigations/${id}/resolve`, { resolution, recoveryAmountCents }),
};
