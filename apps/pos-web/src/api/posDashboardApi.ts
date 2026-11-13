// posDashboardApi.ts — POS Dashboard client, reconciled to the real backend routes (see api contract audit).
import { api } from "./client";
import type { LiveOpsKpiCheck } from "@aipowersalon/api-contracts/tenant";
const rq = (range?: string) => (range ? `?range=${encodeURIComponent(range)}` : '');
export const posDashboardApi = {
  getState: () => api.get(`/pos/dashboard/state`),
  getQueue: () => api.get(`/pos/dashboard/queue`),
  /** Live Operations 04: each KPI as served vs recomputed vs the Overview authority — read only */
  kpiCheck: () => api.get<LiveOpsKpiCheck>(`/pos/dashboard/kpi-check`),
  // §9 period-scoped slices — used by the on-card period dropdowns (Today / This Week / This Month).
  getRevenueTrend: (range?: string) => api.get(`/pos/dashboard/revenue-trend${rq(range)}`),
  getTopServices: (range?: string) => api.get(`/pos/dashboard/top-services${rq(range)}`),
  getPaymentMix: (range?: string) => api.get(`/pos/dashboard/payment-mix${rq(range)}`),
  walkIn: (body: Record<string, unknown>) => api.post(`/pos/check-in/walk-in`, body),
  sendToCheckout: (ticketId: string) => api.post(`/pos/service-done/tickets/${ticketId}/send-to-checkout`),
};
