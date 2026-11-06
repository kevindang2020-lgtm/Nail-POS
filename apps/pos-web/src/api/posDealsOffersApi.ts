// posDealsOffersApi.ts — Marketing → Deals & Offers (/tenant/marketing/deals), the Deals & Offers guide of Oct 30 2026. The
// management reads over the ONE deals engine for every kind (deals, coupons, automatic promotions, announcements — salon and
// technician): KPIs, the library, the approval inbox, redemption history, details, the read-only checker, system health and
// the assistant (draft only). Create / edit / lifecycle / approve / reject / request changes are posDealsApi (pos/deals).
import { api } from './client';
import type { CouponAssistGoal, CouponCheck } from './posCouponsApi';

const qs = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
export const posDealsOffersApi = {
  kpis: () => api.get<any>(`/pos/deals-offers/kpis`),
  library: (q: Record<string, unknown>) => api.get<any>(`/pos/deals-offers/library`, qs(q)),
  approvals: (q: Record<string, unknown>) => api.get<any>(`/pos/deals-offers/approvals`, qs(q)),
  redemptions: (q: Record<string, unknown>) => api.get<any>(`/pos/deals-offers/redemptions`, qs(q)),
  detail: (id: string) => api.get<any>(`/pos/deals-offers/${encodeURIComponent(id)}`),
  check: (id: string, body: { ticketNumber?: string | null; serviceIds?: string[]; spendCents?: number | null; codeEntered?: boolean }) => api.post<CouponCheck>(`/pos/deals-offers/${encodeURIComponent(id)}/check`, body),
  health: () => api.get<any>(`/pos/deals-offers/health`),
  runHealth: () => api.post<any>(`/pos/deals-offers/health/run`, {}),
  healthRuns: (q: { page: number; pageSize: number }) => api.get<any>(`/pos/deals-offers/health/runs`, q as unknown as Record<string, unknown>),
  suggest: (goal: CouponAssistGoal) => api.post<any>(`/pos/deals-offers/assistant/suggest`, { goal }),
  draft: (body: Record<string, unknown>) => api.post<any>(`/pos/deals-offers/assistant/draft`, body),
};
