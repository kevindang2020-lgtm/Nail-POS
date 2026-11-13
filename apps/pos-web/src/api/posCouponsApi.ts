// posCouponsApi.ts — Marketing → Coupons (Coupons & Promotions Management Center, Oct 30 2026). The management additions
// over the one coupon engine: the read-only checker (Checkout's own engine), related campaigns, health and the assistant
// (draft only). Lists / KPIs / history / details are posDiscountsApi; create / edit / lifecycle / duplicate are posDealsApi.
import { api } from './client';

type VerdictCode = 'ELIGIBLE' | 'NOT_YET_ACTIVE' | 'EXPIRED' | 'PAUSED' | 'WRONG_BRANCH' | 'INELIGIBLE_SERVICE' | 'MIN_SPEND' | 'LIMIT_REACHED' | 'ALREADY_USED'
  | 'REQUIRES_APPROVAL' | 'CONFIG_MISSING' | 'NOT_COMBINABLE' | 'NEEDS_CUSTOMER' | 'NEEDS_CODE' | 'CUSTOMER_INELIGIBLE' | 'NOT_AVAILABLE';
export interface CouponCheck {
  verdict: VerdictCode; eligible: boolean; action: string; reasons: { code: VerdictCode; engineCode: string; message: string; params?: Record<string, unknown> }[];
  dealId: string; title: string; status: string; discountPreviewCents: number; eligibleBaseCents: number;
  context: { ticketId: string | null; customerId: string | null; serviceIds: string[]; spendCents: number; onTicket: number; policy: string };
  /** Extras · Coupons 06 — why this offer does / does not combine with each other benefit (the pricing engine's own rules) */
  stacking?: { mode: string; rows: { benefit: string; combines: 'yes' | 'no' | 'conditional' | 'limit' | 'none'; reason: string; message: string; value?: number | null }[] };
}
export type CouponAssistGoal = 'slow_weekdays' | 'promote_service' | 'returning_visits' | 'reconnect_inactive';
export const posCouponsApi = {
  check: (dealId: string, body: { ticketNumber?: string | null; serviceIds?: string[]; spendCents?: number | null; codeEntered?: boolean; customerId?: string | null; branchId?: string | null }) => api.post<CouponCheck>(`/pos/coupons/${encodeURIComponent(dealId)}/check`, body),
  campaigns: (dealId: string) => api.get<any>(`/pos/coupons/${encodeURIComponent(dealId)}/campaigns`),
  health: () => api.get<any>(`/pos/coupons/health`),
  runHealth: () => api.post<any>(`/pos/coupons/health/run`, {}),
  healthRuns: (q: { page: number; pageSize: number }) => api.get<any>(`/pos/coupons/health/runs`, q as unknown as Record<string, unknown>),
  suggest: (goal: CouponAssistGoal) => api.post<any>(`/pos/coupons/assistant/suggest`, { goal }),
  draft: (body: Record<string, unknown>) => api.post<any>(`/pos/coupons/assistant/draft`, body),
  duplicate: (dealId: string, body: { title?: string | null; code?: string | null }) => api.post<any>(`/pos/deals/${encodeURIComponent(dealId)}/duplicate`, body),
};
