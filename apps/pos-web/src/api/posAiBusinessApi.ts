// posAiBusinessApi.ts — client for the AI Business Assistant (/pos/ai-business/*). The server derives tenant/branch;
// the client never sends them. `ask` posts a bounded intent or a free-text question; the rest are read-only tools.
import { api } from "./client";

type Q = Record<string, string | number | undefined | null>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;
const enc = encodeURIComponent;

export const posAiBusinessApi = {
  ask: (body: { question?: string; intent?: string; preset?: string; comparePreset?: string; from?: string; to?: string }) =>
    api.post(`/pos/ai-business/ask`, body),
  dailyBrief: (preset?: string) => api.get(`/pos/ai-business/daily-brief`, preset ? { preset } : undefined),
  compareBranches: (q: { preset?: string; from?: string; to?: string; q?: string; includeInactive?: string; page?: number; pageSize?: number } = {}) =>
    api.get(`/pos/ai-business/branches/compare`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>),
  metrics: () => api.get(`/pos/ai-business/metrics`),
  revenueSummary: (preset: string) => api.get(`/pos/ai-business/revenue/summary`, { preset }),
  appointmentMetrics: (preset: string) => api.get(`/pos/ai-business/appointments/metrics`, { preset }),
  // Saved questions (§35): create/list/delete/use, tenant + user scoped by the server.
  savedList: () => api.get(`/pos/ai-business/saved-questions`),
  savedCreate: (body: { title: string; intent: string; preset?: string; comparePreset?: string; question?: string; sharingScope?: 'private' | 'tenant' }) =>
    api.post(`/pos/ai-business/saved-questions`, body),
  savedDelete: (id: string) => api.del(`/pos/ai-business/saved-questions/${id}`),
  savedUse: (id: string) => api.post(`/pos/ai-business/saved-questions/${id}/use`),
  // Alerts (§34): CRUD + evaluate-now.
  alertCreate: (body: { title: string; metricId: string; operator: 'lt' | 'gt'; threshold: number; preset?: string; minSampleSize?: number; channel?: string; frequency?: string }) =>
    api.post(`/pos/ai-business/alerts`, body),
  alertUpdate: (id: string, body: { active?: boolean; threshold?: number; title?: string; preset?: string; minSampleSize?: number }) => api.patch(`/pos/ai-business/alerts/${id}`, body),
  alertDelete: (id: string) => api.del(`/pos/ai-business/alerts/${id}`),
  // AI Business Reports + Alerts guides (Nov 3 2026): the center. Retired from the client (pinned in posAiBusinessApi.retired.test.ts):
  //   reportsList / reportGet / reportCreate — the 100 newest, no search or pages, no period recorded → center.reports / report / generate
  //   alertsList / alertEvaluate — no evaluation history → center.rules / evaluate (recorded with the exact days and the state change)
  center: {
    reportSummary: () => api.get<any>('/pos/ai-business/center/reports/summary'),
    reports: (q: Q = {}) => api.get<any>('/pos/ai-business/center/reports', clean(q)),
    report: (id: string) => api.get<any>(`/pos/ai-business/center/reports/${enc(id)}`),
    generate: (reportType: string, preset?: string) => api.post<any>('/pos/ai-business/center/reports/generate', { reportType, ...(preset ? { preset } : {}) }),
    regenerate: (id: string) => api.post<any>(`/pos/ai-business/center/reports/${enc(id)}/regenerate`, {}),
    verify: (id: string) => api.post<any>(`/pos/ai-business/center/reports/${enc(id)}/verify`, {}),
    reportCheck: () => api.post<any>('/pos/ai-business/center/reports/check', {}),
    alertSummary: () => api.get<any>('/pos/ai-business/center/alerts/summary'),
    rules: (q: Q = {}) => api.get<any>('/pos/ai-business/center/alerts/rules', clean(q)),
    history: (q: Q = {}) => api.get<any>('/pos/ai-business/center/alerts/history', clean(q)),
    evaluate: (id: string) => api.post<any>(`/pos/ai-business/center/alerts/${enc(id)}/evaluate`, {}),
    acknowledge: (eventId: string, note?: string) => api.post<any>(`/pos/ai-business/center/alerts/events/${enc(eventId)}/acknowledge`, note ? { note } : {}),
    explain: (eventId: string) => api.get<any>(`/pos/ai-business/center/alerts/events/${enc(eventId)}/explain`),
    anomaly: () => api.get<any>('/pos/ai-business/center/alerts/anomaly'),
    alertCheck: () => api.post<any>('/pos/ai-business/center/alerts/check', {}),
    // A3 (Nov 6 2026): fair scorecard, measured explanation, growth advisor, Branch Data Health Checker
    branchScorecard: (q: Q = {}) => api.get<any>('/pos/ai-business/center/branches/scorecard', clean(q)),
    branchExplain: (q: Q) => api.get<any>('/pos/ai-business/center/branches/explain', clean(q)),
    branchCheck: () => api.post<any>('/pos/ai-business/center/branches/check', {}),
    // A4 (Nov 6 2026): stored assistant history + Check Business Data
    assistantHistory: (q: Q = {}) => api.get<any>('/pos/ai-business/center/assistant/history', clean(q)),
    assistantHistoryDelete: (id: string) => api.del<any>(`/pos/ai-business/center/assistant/history/${enc(id)}`),
    assistantCheck: () => api.post<any>('/pos/ai-business/center/assistant/check', {}),
    // A2 (Nov 6 2026): incidents + per-rule notification settings
    incidents: (q: Q = {}) => api.get<any>('/pos/ai-business/center/alerts/incidents', clean(q)),
    incident: (eventId: string) => api.get<any>(`/pos/ai-business/center/alerts/incidents/${enc(eventId)}`),
    incidentAction: (eventId: string, b: { action: string; expectedVersion: number; note?: string | null; assigneeUserId?: string | null; snoozeMinutes?: number | null }) =>
      api.post<any>(`/pos/ai-business/center/alerts/incidents/${enc(eventId)}/action`, b),
    incidentNote: (eventId: string, note: string) => api.post<any>(`/pos/ai-business/center/alerts/incidents/${enc(eventId)}/notes`, { note }),
    alertDelivery: (alertId: string) => api.get<any>(`/pos/ai-business/center/alerts/${enc(alertId)}/delivery`),
    alertSetDelivery: (alertId: string, b: { severity?: string; channels?: string[]; recipientUserIds?: string[]; quietHoursStart?: number; quietHoursEnd?: number; cooldownMinutes?: number }) =>
      api.post<any>(`/pos/ai-business/center/alerts/${enc(alertId)}/delivery`, b),
  },
};
