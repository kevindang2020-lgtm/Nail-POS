// posMarketingGrowthApi.ts — Marketing & Growth (Complete Build Guide, Oct 30 2026): `/pos/marketing-growth/*`.
// Read-only: GATE 0 reconciliation, one grouped search, the activity history, a customer's marketing journey (audited) and
// the cost & profit view (owners / managers). The dashboard's section numbers keep coming from the endpoints that own them.
import { api } from './client';

type Q = Record<string, string | number | undefined | null>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;

export const MG_SCOPES = ['all', 'customers', 'campaigns', 'offers', 'loyalty', 'referrals', 'gift_cards', 'reviews'] as const;
export const MG_EVENT_TYPES = ['campaign', 'message', 'redemption', 'loyalty', 'referral', 'gift_card', 'review'] as const;
export type GrowthMgScope = (typeof MG_SCOPES)[number];

export const posMarketingGrowthApi = {
  reconciliation: (q: Q = {}) => api.get<any>(`/pos/marketing-growth/reconciliation`, clean(q)),
  search: (q: Q) => api.get<any>(`/pos/marketing-growth/search`, clean(q)),
  activity: (q: Q) => api.get<any>(`/pos/marketing-growth/activity`, clean(q)),
  journey: (customerId: string, q: Q = {}) => api.get<any>(`/pos/marketing-growth/journey/${encodeURIComponent(customerId)}`, clean(q)),
  economics: (q: Q = {}) => api.get<any>(`/pos/marketing-growth/economics`, clean(q)),
};
