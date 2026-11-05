// posAIMarketingApi.ts — AI Marketing Assistant (read). Permission-gated pos.marketing.view server-side.
// The client never sends a tenantId — tenant/branch are server-derived from the session cookie.
import { api } from './client';

export const posAIMarketingApi = {
  state: () => api.get(`/pos/ai-marketing/state`),
  // Aggregate-only audience preview. Body is an approved AudienceDefinition (registry-validated server-side).
  previewAudience: (def: Record<string, unknown>) => api.post(`/pos/ai-marketing/audience/preview`, def),
  // Generate an editable SMS/email/push draft. Never sends; server validates against invented offers/tokens/URLs.
  generateDraft: (req: Record<string, unknown>) => api.post(`/pos/ai-marketing/content/draft`, req),
  // Per-campaign results funnel + associated (not causal) revenue.
  campaignResults: (id: string) => api.get(`/pos/ai-marketing/campaigns/${id}/results`),
  // Submit a campaign for approval (creates a draft + persists the send plan). Does not send.
  submitCampaign: (body: Record<string, unknown>) => api.post(`/pos/ai-marketing/campaigns`, body),
  // Approve + schedule a draft campaign (moves draft → scheduled). Does not send.
  approveCampaign: (id: string, scheduledAt: string) => api.post(`/pos/ai-marketing/campaigns/${id}/approve`, { scheduledAt }),
};
