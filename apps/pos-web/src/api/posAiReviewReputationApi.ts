// posAiReviewReputationApi.ts — typed client for the AI Review & Reputation endpoints. Reads return inbox/detail/
// analytics/branch-comparison/integration status; mutations draft/approve/publish/escalate/record recovery. The client
// never sends tenant/branch — the server derives them. No money moves here; recovery only records a recommendation.
import { api } from './client';

const enc = encodeURIComponent;

export const posAiReviewReputationApi = {
  inbox: (filters?: Record<string, unknown>) => api.get<any>(`/pos/ai-review-reputation/inbox`, { query: filters }),
  detail: (id: string) => api.get<any>(`/pos/ai-review-reputation/${enc(id)}`),
  settings: () => api.get<any>(`/pos/ai-review-reputation/settings`),
  updateSettings: (patch: { level?: 'tenant' | 'branch'; branchId?: string | null; enabled?: boolean | null; config?: any }) => api.put<any>(`/pos/ai-review-reputation/settings`, patch),
  analytics: (query?: { from?: string; to?: string; branchId?: string; prevFrom?: string; prevTo?: string }) => api.get<any>(`/pos/ai-review-reputation/analytics`, { query }),
  branchComparison: (query?: { from?: string; to?: string }) => api.get<any>(`/pos/ai-review-reputation/branch-comparison`, { query }),
  urgentQueue: () => api.get<any>(`/pos/ai-review-reputation/escalations/urgent`),
  integrationStatus: () => api.get<any>(`/pos/ai-review-reputation/integration-status`),

  sync: (source: string, since?: string | null) => api.post<any>(`/pos/ai-review-reputation/sync`, { source, since: since ?? null }),
  draft: (id: string, directive: string, reviewText: string | null) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/draft`, { directive, reviewText }),
  requestApproval: (id: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/request-approval`, {}),
  approve: (id: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/approve`, {}),
  reject: (id: string, reason: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/reject`, { reason }),
  publish: (id: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/publish`, {}),

  acknowledge: (escId: string) => api.post<any>(`/pos/ai-review-reputation/escalations/${enc(escId)}/acknowledge`, {}),
  assignEscalation: (escId: string, userId: string) => api.post<any>(`/pos/ai-review-reputation/escalations/${enc(escId)}/assign`, { userId }),
  resolveEscalation: (escId: string, reviewId: string) => api.post<any>(`/pos/ai-review-reputation/escalations/${enc(escId)}/resolve`, { reviewId }),
  recordRecovery: (id: string, type: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/recovery`, { type }),
  addNote: (id: string, note: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/notes`, { note }),
};
