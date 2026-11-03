// posAIMarketingApi.ts — AI Marketing Assistant family. Permission-gated server-side (pos.marketing.view / .manage); the client
// never sends a tenantId — tenant / branch come from the session.
//
// AI Marketing guides (Nov 3 2026): the pages read `center` (the seven cards in a period, Reach & Consent, budget vs money spent,
// recommendations from the Customer Retention rule, the eligibility funnel, segments / price / budget, Check AI Marketing System)
// and the campaign list / funnels from Campaign Center. Retired from the client (pinned in posAIMarketingApi.retired.test.ts):
//   state           — summed campaign BUDGETS as "message cost" and used its own "lapsed" rule → center.summary / recommendations
//   previewAudience — the same "lapsed" rule (a customer who came back yesterday still counted) → center.eligibility
//   submitCampaign / approveCampaign — scheduled a campaign without Campaign Center's approval → center.saveDraft + Campaign Center
//   campaignResults — read the old counters → Campaign Center detail (each count from its own source)
import { api } from './client';

type Q = Record<string, string | number | undefined | null>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;

export type MkKind = 'rebooking' | 'winback' | 'birthday';
export const posAIMarketingApi = {
  // Generate an editable SMS/email/push draft. Never sends; server validates against invented offers/tokens/URLs.
  generateDraft: (req: Record<string, unknown>) => api.post(`/pos/ai-marketing/content/draft`, req),
  center: {
    summary: (q: Q = {}) => api.get<any>('/pos/ai-marketing/center/summary', clean(q)),
    recommendations: (channel: 'sms' | 'email' = 'sms') => api.get<any>('/pos/ai-marketing/center/recommendations', { channel }),
    eligibility: (kind: MkKind, channel: 'sms' | 'email' | 'both') => api.post<any>('/pos/ai-marketing/center/eligibility', { kind, channel }),
    estimate: (b: { channel: 'sms' | 'email'; body: string; recipients: number; budgetCents?: number | null }) => api.post<any>('/pos/ai-marketing/center/estimate', b),
    saveDraft: (b: { kind: 'rebooking' | 'winback'; channel: 'sms' | 'email'; name?: string | null; message: string; subject?: string | null; budgetCents?: number | null; idempotencyKey: string }) =>
      api.post<any>('/pos/ai-marketing/center/save-draft', b),
    check: () => api.post<any>('/pos/ai-marketing/center/check', {}),
  },
};
