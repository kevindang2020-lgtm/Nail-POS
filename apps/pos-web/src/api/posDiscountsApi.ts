// posDiscountsApi.ts — Services → Discounts (Oct 29 2026): the read model over the coupon engine (`/pos/discounts/*`,
// pos.marketing.view; the CSV exports pos.marketing.manage). Promotions (`/pos/salon-promotions`) stays the rule editor.
import { api } from './client';
import type { DiscountRefundImpact } from '@aipowersalon/api-contracts/tenant';

type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
export const posDiscountsApi = {
  kpis: (q: { expiringDays?: number } = {}) => api.get<any>(`/pos/discounts/kpis`, clean(q as Q)),
  list: (q: Q) => api.get<any>(`/pos/discounts`, clean(q)),
  /** Refund Impact Preview (Extras · Discounts 11): what a refund would do to each discount on the ticket — read-only */
  refundImpact: (ticketId: string, lineIds: string[] | null) => api.get<DiscountRefundImpact>(`/pos/discounts/refund-impact/${encodeURIComponent(ticketId)}`, clean({ lineIds: lineIds && lineIds.length ? lineIds.join(',') : undefined })),
  redemptions: (q: Q) => api.get<any>(`/pos/discounts/redemptions`, clean(q)),
  performance: (q: Q) => api.get<any>(`/pos/discounts/performance`, clean(q)),
  detail: (dealId: string) => api.get<any>(`/pos/discounts/${encodeURIComponent(dealId)}`),
  exportList: (q: Q) => api.exportAsync<string>(`/pos/discounts/export`, clean(q), 'text'),
  exportRedemptions: (q: Q) => api.exportAsync<string>(`/pos/discounts/export/redemptions`, clean(q), 'text'),
};
