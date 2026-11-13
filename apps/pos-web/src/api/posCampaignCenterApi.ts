// posCampaignCenterApi.ts — Marketing → Campaign Center (Campaign Center Complete Build Guide, Oct 30 2026): the honest read model
// (each count from its own source), search across campaigns and campaign recipients, the six-step draft → audience → preview →
// approval → launch flow, Check Campaign System and the assistant. Nothing here sends a message; Launch schedules an approved
// campaign and the server's send worker does the rest. Cancel / complete stay on posCampaignsApi (the existing routes).
import { api } from './client';

type Q = Record<string, string | number | undefined | null>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;
const enc = encodeURIComponent;

export interface CcCounts {
  selected: number | null; selectedIsEstimate: boolean; eligible: number | null; excluded: number | null;
  queued: number; attempted: number; submitted: number; skippedAtSend: number; failed: number; delivered: number; unknown: number; simulated: number;
  booked: number; redemptions: number; discountCents: number; associatedRevenueCents: number; legacyRevenueCents: number; legacySentCount: number;
  actualCostCents: number | null; roi: number | null; roiNote: string;
  /** server-computed (extras): comparison ratios and booking de-duplication facts — optional for older servers */
  deliveryRatePercent?: number | null; costPerBookingCents?: number | null; bookedDuplicatesIgnored?: number; firstBookedAt?: string | null; lastBookedAt?: string | null;
  /** extras Marketing 11 (server): exposure / associated booking / validated (campaign code redeemed on a paid ticket), kept apart */
  attribution?: { exposure: { delivered: number; submitted: number }; associated: { bookings: number }; validated: { redemptions: number; revenueCents: number } };
}
export interface CcCampaign {
  id: string; name: string; goal: string | null; description: string | null; offer: string | null; channel: 'sms' | 'email' | 'push'; branchId: string | null;
  status: string; displayStatus: string; outcome: string | null; origin: string; audienceLabel: string | null; audienceSource: string; snapshotVersion: number;
  dealId: string | null; dealName: string | null; messageBody: string | null; emailSubject: string | null; messageVersion: number; budgetCents: number;
  createdAt: string; updatedAt: string; scheduledAt: string | null; proposedSendAt?: string | null; startedAt: string | null; completedAt: string | null;
  createdBy: string | null; submittedAt: string | null; approvedAt: string | null; approvedBy: string | null; approvalCurrent: boolean; counts: CcCounts;
}
interface CcPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }
export interface CcPage { page: number; pageSize: number; totalItems: number; totalPages: number }

export const posCampaignCenterApi = {
  overview: (q: Q) => api.get<any>('/pos/campaign-center/overview', clean(q)),
  list: (q: Q) => api.get<{ items: CcCampaign[]; pagination: CcPage; period: CcPeriod; basis: string; sort: string }>('/pos/campaign-center/campaigns', clean(q)),
  searchRecipients: (q: Q) => api.get<any>('/pos/campaign-center/recipients', clean(q)),
  audienceSources: (channel: string) => api.get<any>('/pos/campaign-center/audience-sources', { channel }),
  detail: (id: string) => api.get<any>(`/pos/campaign-center/campaigns/${enc(id)}`),
  recipients: (id: string, q: Q) => api.get<any>(`/pos/campaign-center/campaigns/${enc(id)}/recipients`, clean(q)),
  events: (id: string, q: Q) => api.get<any>(`/pos/campaign-center/campaigns/${enc(id)}/events`, clean(q)),
  audit: (id: string) => api.get<any>(`/pos/campaign-center/campaigns/${enc(id)}/audit`),
  create: (b: Record<string, unknown>) => api.post<{ id: string }>('/pos/campaign-center/campaigns', b),
  update: (id: string, b: Record<string, unknown>) => api.patch<any>(`/pos/campaign-center/campaigns/${enc(id)}`, b),
  setAudience: (id: string, draftId: string) => api.post<any>(`/pos/campaign-center/campaigns/${enc(id)}/audience`, { draftId }),
  preview: (id: string) => api.post<any>(`/pos/campaign-center/campaigns/${enc(id)}/preview`, {}),
  submit: (id: string) => api.post<any>(`/pos/campaign-center/campaigns/${enc(id)}/submit`, {}),
  approve: (id: string) => api.post<any>(`/pos/campaign-center/campaigns/${enc(id)}/approve`, {}),
  launch: (id: string, at: string | null) => api.post<any>(`/pos/campaign-center/campaigns/${enc(id)}/launch`, { confirm: true, ...(at ? { at } : {}) }),
  unschedule: (id: string) => api.post<any>(`/pos/campaign-center/campaigns/${enc(id)}/unschedule`, {}),
  duplicate: (id: string) => api.post<{ id: string }>(`/pos/campaign-center/campaigns/${enc(id)}/duplicate`, {}),
  healthCheck: (campaignId?: string | null) => api.post<any>('/pos/campaign-center/health-check', campaignId ? { campaignId } : {}),
  suggest: (goal: string) => api.post<any>('/pos/campaign-center/assistant/suggest', { goal }),
  saveSuggestion: (b: { goal: string; name?: string; messageBody?: string }) => api.post<{ id: string }>('/pos/campaign-center/assistant/draft', b),
};
