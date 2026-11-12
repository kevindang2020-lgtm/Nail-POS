// posAIMoneyProtectionApi.ts — AI Money Protection (read + advisory + investigation). Tenant/branch are
// server-derived from the session; the client never sends a tenantId. Detection/mutation of money never happens
// here — these endpoints only read alerts, request an advisory explanation, and manage investigations.
import { api } from './client';

type Q = Record<string, string | number | undefined>;
const clean = (o: Q) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>;

// the six Money Protection guides (Nov 3 2026): the read side + the few human actions live in /pos/money-protection-center/*.
// Retired from the client (the center replaces them): state, rules, getSettings, updateSetting, alerts, listInvestigations, getInvestigation.
export const posAIMoneyProtectionApi = {
  center: {
    summary: () => api.get<any>(`/pos/money-protection-center/summary`),
    alerts: (q: Q = {}) => api.get<any>(`/pos/money-protection-center/alerts`, clean(q)),
    alert: (id: string) => api.get<any>(`/pos/money-protection-center/alerts/detail`, { id }),
    alertAction: (b: { id: string; action: 'acknowledge' | 'dismiss' | 'reopen'; reason?: string | null; expectedStatus?: string | null }) => api.post<any>(`/pos/money-protection-center/alerts/action`, b),
    investigations: (q: Q = {}) => api.get<any>(`/pos/money-protection-center/investigations`, clean(q)),
    timeline: (id: string) => api.get<any>(`/pos/money-protection-center/investigations/timeline`, { id }),
    rules: () => api.get<any>(`/pos/money-protection-center/rules`),
    saveRule: (b: { ruleId: string; enabled: boolean; severityOverride: string | null; thresholds: Record<string, number | string>; reason?: string | null; expectedUpdatedAt: string | null }) => api.post<any>(`/pos/money-protection-center/rules/save`, b),
    /** Safe Rule Preview (Money Protection 5 · 07): the same route with dryRun — read-only estimate, nothing is saved */
    previewRule: (b: { ruleId: string; thresholds: Record<string, number | string> }) => api.post<any>(`/pos/money-protection-center/rules/save`, { ...b, dryRun: true }),
    history: (q: Q = {}) => api.get<any>(`/pos/money-protection-center/settings/history`, clean(q)),
    runs: (q: Q = {}) => api.get<any>(`/pos/money-protection-center/detection/runs`, clean(q)),
    runDetection: () => api.post<any>(`/pos/money-protection-center/detection/run`, {}),
    check: () => api.post<any>(`/pos/money-protection-center/check`, {}),
  },
  // Advisory AI explanation of a single alert (sanitized server-side; never accusatory).
  explainAlert: (id: string) => api.post(`/pos/ai-money-protection/alerts/${id}/explain`, {}),
  createInvestigation: (body: Record<string, unknown>) => api.post<any>(`/pos/ai-money-protection/investigations`, body),
  addNote: (id: string, body: string) => api.post(`/pos/ai-money-protection/investigations/${id}/notes`, { body }),
  assignInvestigation: (id: string, assigneeUserId: string) => api.post(`/pos/ai-money-protection/investigations/${id}/assign`, { assigneeUserId }),
  setInvestigationStatus: (id: string, status: string) => api.post(`/pos/ai-money-protection/investigations/${id}/status`, { status }),
  resolveInvestigation: (id: string, resolution: string, recoveryAmountCents?: number) => api.post(`/pos/ai-money-protection/investigations/${id}/resolve`, { resolution, recoveryAmountCents }),
};
