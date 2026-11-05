// posDealsApi.ts — tenant Deals Marketplace administration (manager/owner). Server-gated by pos.marketing.view (reads)
// and pos.marketing.manage (writes) on /pos/deals. Salon deals + technician-deal approval + the tenant technician-deal
// policy. Money is integer cents; the backend recomputes the final price — the client never sends it.
import type { DealAnalyticsRow, DealSettings, DealStatus, DealView } from '@aipowersalon/api-contracts/tenant';
export type { DealAnalyticsRow, DealSettings, DealStatus, DealView };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';




export const posDealsApi = {
  list: (status?: string) => api.get(`/pos/deals${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  get: (id: string) => api.get(`/pos/deals/${id}`),
  create: (body: Record<string, unknown>) => api.post(`/pos/deals`, body),
  submit: (id: string) => api.post(`/pos/deals/${id}/submit`, {}),
  approve: (id: string, reason?: string) => api.post(`/pos/deals/${id}/approve`, reason ? { reason } : {}),
  reject: (id: string, reason: string) => api.post(`/pos/deals/${id}/reject`, { reason }),
  pause: (id: string) => api.post(`/pos/deals/${id}/pause`, {}),
  resume: (id: string) => api.post(`/pos/deals/${id}/resume`, {}),
  publish: (id: string) => api.post(`/pos/deals/${id}/publish`, {}),
  getSettings: () => api.get(`/pos/deals/settings`),
  updateSettings: (body: Partial<DealSettings>) => api.patch(`/pos/deals/settings`, body),
  analytics: () => api.get(`/pos/deals/analytics`),
  // BUILD_PLAN Phase 5 — dashboard, simulator, editing, versions, coupons
  listKind: (kind: string) => api.get(`/pos/deals?kind=${encodeURIComponent(kind)}`),
  dashboard: (days = 30) => api.get(`/pos/deals/dashboard?days=${days}`),
  exportCsv: (days = 30) => api.exportAsync<{ format: string; filename: string; csv: string }>(`/pos/deals/export`, { days }),
  preview: (deal: Record<string, unknown>, sample: Record<string, unknown>) => api.post(`/pos/deals/preview`, { deal, sample }),
  update: (id: string, body: Record<string, unknown>) => api.patch(`/pos/deals/${id}`, body),
  versions: (id: string) => api.get(`/pos/deals/${id}/versions`),
  cancel: (id: string) => api.post(`/pos/deals/${id}/cancel`, {}),
  archive: (id: string) => api.post(`/pos/deals/${id}/archive`, {}),
  coupons: (id: string) => api.get(`/pos/deals/${id}/coupons`),
  generateCodes: (id: string, body: Record<string, unknown>) => api.post(`/pos/deals/${id}/coupons/generate`, body),
  revokeCode: (id: string, codeId: string, reason: string) => api.post(`/pos/deals/${id}/coupons/${codeId}/revoke`, { reason }),
};

export interface DealsDashboard {
  days: number;
  live: { active: number; scheduled: number; pendingApproval: number; activeCoupons: number };
  totals: { openApplications: number; openDiscountCents: number; redemptions: number; netDiscountCents: number; views: number; reversals: number } | null;
  daily: { day: string; views: number; bookings: number; applications: number; redemptions: number; reversals: number; discountedCents: number; reversedCents: number }[];
  top: { dealId: string; title: string; kind: string; status: string; redemptionCount: number; maxRedemptions: number | null; budgetCents: number | null; budgetReservedCents: number; discountedCents: number; views: number; redemptions: number; conversion: number | null }[];
}
export interface DealPreview {
  problems: string[];
  eligibility: { eligible: boolean; reasons: { code: string; message: string; params?: Record<string, unknown> }[] };
  pricing: { subtotalCents: number; totalDiscountCents: number; lines: { lineId: string; priceCents: number; discountCents: number; netCents: number }[]; rejected: { id: string; reason: string; message: string }[] };
  originalPriceCents: number | null; finalPriceCents: number | null;
}

