// posAiBusinessApi.ts — client for the AI Business Assistant (/pos/ai-business/*). The server derives tenant/branch;
// the client never sends them. `ask` posts a bounded intent or a free-text question; the rest are read-only tools.
import { api } from "./client";

export const posAiBusinessApi = {
  ask: (body: { question?: string; intent?: string; preset?: string; comparePreset?: string }) =>
    api.post(`/pos/ai-business/ask`, body),
  dailyBrief: (preset?: string) => api.get(`/pos/ai-business/daily-brief`, preset ? { preset } : undefined),
  compareBranches: (preset?: string) => api.get(`/pos/ai-business/branches/compare`, preset ? { preset } : undefined),
  metrics: () => api.get(`/pos/ai-business/metrics`),
  // Saved questions (§35): create/list/delete/use, tenant + user scoped by the server.
  savedList: () => api.get(`/pos/ai-business/saved-questions`),
  savedCreate: (body: { title: string; intent: string; preset?: string; comparePreset?: string; question?: string; sharingScope?: 'private' | 'tenant' }) =>
    api.post(`/pos/ai-business/saved-questions`, body),
  savedDelete: (id: string) => api.del(`/pos/ai-business/saved-questions/${id}`),
  savedUse: (id: string) => api.post(`/pos/ai-business/saved-questions/${id}/use`),
  // Alerts (§34): CRUD + evaluate-now.
  alertsList: () => api.get(`/pos/ai-business/alerts`),
  alertCreate: (body: { title: string; metricId: string; operator: 'lt' | 'gt'; threshold: number; preset?: string; minSampleSize?: number; channel?: string; frequency?: string }) =>
    api.post(`/pos/ai-business/alerts`, body),
  alertUpdate: (id: string, body: { active?: boolean; threshold?: number; title?: string }) => api.patch(`/pos/ai-business/alerts/${id}`, body),
  alertDelete: (id: string) => api.del(`/pos/ai-business/alerts/${id}`),
  alertEvaluate: (id: string) => api.post(`/pos/ai-business/alerts/${id}/evaluate`),
  // Generated reports (§36): create (generates), list, get by id.
  reportCreate: (reportType: string) => api.post(`/pos/ai-business/reports`, { reportType }),
  reportsList: () => api.get(`/pos/ai-business/reports`),
  reportGet: (id: string) => api.get(`/pos/ai-business/reports/${id}`),
};
