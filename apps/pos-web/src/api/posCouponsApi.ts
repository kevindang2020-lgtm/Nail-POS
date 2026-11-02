// posCouponsApi.ts — Marketing → Coupons (Coupons & Promotions Management Center, Oct 30 2026). The management additions
// over the one coupon engine: the read-only checker (Checkout's own engine), related campaigns, health and the assistant
// (draft only). Lists / KPIs / history / details are posDiscountsApi; create / edit / lifecycle / duplicate are posDealsApi.
import { api } from './client';

export type VerdictCode = 'ELIGIBLE' | 'NOT_YET_ACTIVE' | 'EXPIRED' | 'PAUSED' | 'WRONG_BRANCH' | 'INELIGIBLE_SERVICE' | 'MIN_SPEND' | 'LIMIT_REACHED' | 'ALREADY_USED'
  | 'REQUIRES_APPROVAL' | 'CONFIG_MISSING' | 'NOT_COMBINABLE' | 'NEEDS_CUSTOMER' | 'NEEDS_CODE' | 'CUSTOMER_INELIGIBLE' | 'NOT_AVAILABLE';
export interface CouponCheck {
  verdict: VerdictCode; eligible: boolean; action: string; reasons: { code: VerdictCode; engineCode: string; message: string; params?: Record<string, unknown> }[];
  dealId: string; title: string; status: string; discountPreviewCents: number; eligibleBaseCents: number;
  context: { ticketId: string | null; customerId: string | null; serviceIds: string[]; spendCents: number; onTicket: number; policy: string };
}
export type AssistGoal = 'slow_weekdays' | 'promote_service' | 'returning_visits' | 'reconnect_inactive';
export const posCouponsApi = {
  check: (dealId: string, body: { ticketNumber?: string | null; serviceIds?: string[]; spendCents?: number | null; codeEntered?: boolean }) => api.post<CouponCheck>(`/pos/coupons/${encodeURIComponent(dealId)}/check`, body),
  campaigns: (dealId: string) => api.get<any>(`/pos/coupons/${encodeURIComponent(dealId)}/campaigns`),
  health: () => api.get<any>(`/pos/coupons/health`),
  suggest: (goal: AssistGoal) => api.post<any>(`/pos/coupons/assistant/suggest`, { goal }),
  draft: (body: Record<string, unknown>) => api.post<any>(`/pos/coupons/assistant/draft`, body),
  duplicate: (dealId: string, body: { title?: string | null; code?: string | null }) => api.post<any>(`/pos/deals/${encodeURIComponent(dealId)}/duplicate`, body),
};
