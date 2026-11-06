// posPromotionsApi.ts — Marketing → Promotions (Promotions Management guide, Oct 30 2026). A salon promotion IS a coupon, so
// lists / KPIs / history / details are posDiscountsApi, create / edit / lifecycle are posDealsApi and duplicate / assistant
// draft / related campaigns / health are posCouponsApi. This client is only what Promotions adds: the LOGGED read-only check,
// the Eligibility Checks search scope, trends, the assistant's safety flags + message preview, and the activity (audit) tab.
import { api } from './client';
import type { CouponAssistGoal, CouponCheck } from './posCouponsApi';

type Q = Record<string, string | number | undefined | null>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;

export const posPromotionsApi = {
  check: (dealId: string, body: { ticketNumber?: string | null; serviceIds?: string[]; spendCents?: number | null; codeEntered?: boolean }) =>
    api.post<CouponCheck & { checkId: string; checkedAt: string; logged: boolean }>(`/pos/promotions/${encodeURIComponent(dealId)}/check`, body),
  checks: (q: Q) => api.get<any>(`/pos/promotions/eligibility-checks`, clean(q)),
  trends: (q: Q) => api.get<any>(`/pos/promotions/trends`, clean(q)),
  suggest: (goal: CouponAssistGoal) => api.post<any>(`/pos/promotions/assistant/suggest`, { goal }),
  activity: (dealId: string) => api.get<any>(`/pos/promotions/${encodeURIComponent(dealId)}/activity`),
};
