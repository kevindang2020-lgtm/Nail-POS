// techDealsApi.ts — Technician "My Deals" client for the real @Controller('tech/deals') routes. Same-origin, session
// cookie; the server resolves the technician from the session and enforces the salon's technician-deal policy. The
// technician only ever sees/acts on their own deals. Money is integer cents; the backend computes the final price.
import { api } from './client';

export type TechDealStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'active' | 'paused' | 'sold_out' | 'expired' | 'rejected' | 'canceled' | 'archived';

export interface TechDeal {
  id: string; title: string; discountType: 'percent' | 'fixed' | 'fixed_price'; discountPercent: number | null; discountCents: number | null;
  originalPriceCents: number | null; finalPriceCents: number | null; savingsCents: number | null;
  status: TechDealStatus; redemptionCount: number; createdAt: string;
}

export interface TechService { id: string; name: string; priceCents: number }

export interface TechDealSettings {
  allowTechnicianDeals: 'off' | 'on_with_approval' | 'on_auto';
  maxDiscountPercent: number | null; maxFixedDiscountCents: number | null; minServicePriceCents: number | null;
  maxActiveDealsPerTech: number | null;
}

export const techDealsApi = {
  settings: () => api.get<TechDealSettings>('/tech/deals/settings'),
  myDeals: () => api.get<TechDeal[]>('/tech/deals'),
  // Phase 5 (bug 8): the services this technician performs, at catalog price — the server prices the deal from these.
  services: () => api.get<TechService[]>('/tech/deals/services'),
  create: (body: Record<string, unknown>) => api.post<TechDeal>('/tech/deals', body),
  submit: (id: string) => api.post<TechDeal>(`/tech/deals/${id}/submit`, {}),
  pause: (id: string) => api.post<TechDeal>(`/tech/deals/${id}/pause`, {}),
};
