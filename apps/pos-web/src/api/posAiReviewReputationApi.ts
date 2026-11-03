// posAiReviewReputationApi.ts — typed client for the AI Review & Reputation endpoints. Reads return inbox/detail/
// analytics/branch-comparison/integration status; mutations draft/approve/publish/escalate/record recovery. The client
// never sends tenant/branch — the server derives them. No money moves here; recovery only records a recommendation.
import { api } from './client';

const enc = encodeURIComponent;

export const posAiReviewReputationApi = {
  // the workspace READS moved to posReputationApi (/pos/reputation/*, Nov 2 2026); these are the workflow WRITES (settings moved to posReputationSettingsApi, /pos/reputation-settings/*)

  sync: (source: string, since?: string | null) => api.post<any>(`/pos/ai-review-reputation/sync`, { source, since: since ?? null }),
  // the server drafts from the STORED review; no review text is sent from the browser
  draft: (id: string, directive: string) => api.post<any>(`/pos/ai-review-reputation/${enc(id)}/draft`, { directive }),
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
