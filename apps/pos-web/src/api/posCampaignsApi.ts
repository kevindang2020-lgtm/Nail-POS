// posCampaignsApi.ts — Campaign Center client. Reads the tenant-scoped Campaign Center state and drives the campaign
// lifecycle. All endpoints are guarded + tenant-scoped server-side; this client never sends a tenantId.
import { api } from './client';
import type { CampaignCostPreview } from '@aipowersalon/api-contracts';
export type { CampaignCostPreview };

export const posCampaignsApi = {
  getState: (q?: Record<string, unknown>) => api.get<any>('/pos/campaigns/state', q),
  create: (body: Record<string, unknown>) => api.post<any>('/pos/campaigns', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<any>(`/pos/campaigns/${id}`, body),
  schedule: (id: string) => api.post<any>(`/pos/campaigns/${id}/schedule`),
  // wave 3 PAYI §81: the cost preview; a large SMS campaign activates only with confirmEstimate: true (409 CAMPAIGN_CONFIRMATION_REQUIRED otherwise)
  costPreview: (id: string) => api.get<CampaignCostPreview>(`/pos/campaigns/${id}/cost-preview`),
  activate: (id: string, body?: { confirmEstimate?: boolean }) => api.post<any>(`/pos/campaigns/${id}/activate`, body ?? {}),
  complete: (id: string) => api.post<any>(`/pos/campaigns/${id}/complete`),
  cancel: (id: string) => api.post<any>(`/pos/campaigns/${id}/cancel`),
};
