// ownerDealsApi.ts — BUILD_PLAN Phase 5: deals in the Owner App (owner/deals). What deals gave away net of refunds,
// the approval queue, and the approve / reject (with a reason) / pause decisions. Building deals stays on the POS.
import { api } from './client';

export interface OwnerDealRow { id: string; title: string; ownerType: string; technicianId: string | null; kind?: string; discountType: string; discountPercent: number | null; discountCents: number | null; originalPriceCents: number | null; finalPriceCents: number | null; status: string; createdAt: string }
export interface OwnerDealsSummary {
  dashboard: {
    days: number;
    live: { active: number; scheduled: number; pendingApproval: number; activeCoupons: number };
    totals: { openApplications: number; openDiscountCents: number; redemptions: number; netDiscountCents: number; views: number; reversals: number };
    top: { dealId: string; title: string; kind: string; status: string; redemptions: number; discountedCents: number; conversion: number }[];
  };
  pending: OwnerDealRow[];
  switches: { running: boolean; reason: string | null; stackingPolicy: string; allowTechnicianDeals: string; maxActiveDeals: number | null };
}
export const ownerDealsApi = {
  summary: (days = 30) => api.get<OwnerDealsSummary>('/owner/deals/summary', { days: String(days) }),
  approve: (id: string) => api.post<OwnerDealRow>(`/owner/deals/${encodeURIComponent(id)}/approve`, {}),
  reject: (id: string, reason: string) => api.post<OwnerDealRow>(`/owner/deals/${encodeURIComponent(id)}/reject`, { reason }),
  pause: (id: string) => api.post<OwnerDealRow>(`/owner/deals/${encodeURIComponent(id)}/pause`, {}),
};
