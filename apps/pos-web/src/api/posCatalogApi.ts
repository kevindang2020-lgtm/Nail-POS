// posCatalogApi.ts — Services & Products · Service Categories · Service Pricing · Add-Ons (Oct 30 2026): the read model and
// the audited writes at `/pos/catalog/*`. Lists page on the server (newest first) with one search box and a period that
// names its date field; the KPIs say what they count. Creating / editing a service still goes through posServicesApi.
import { api } from './client';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const enc = encodeURIComponent;
const C = '/pos/catalog';
export const posCatalogApi = {
  dashboard: (q: Q) => api.get<any>(`${C}/dashboard`, clean(q)),
  charts: (q: Q) => api.get<any>(`${C}/charts`, clean(q)),
  services: (q: Q) => api.get<any>(`${C}/services`, clean(q)),
  service: (id: string) => api.get<any>(`${C}/services/${enc(id)}`),
  updatePricing: (id: string, b: Q) => api.patch<any>(`${C}/services/${enc(id)}/pricing`, b),
  // D4 gaps (Nov 5 2026): the upcoming bookings a price / duration change would touch, and revert of one change
  pricingImpact: (id: string, q: Q) => api.get<any>(`${C}/services/${enc(id)}/pricing-impact`, clean(q)),
  /** SERVICE PRICING 12: each technician's rate (with its source) and pay at the current vs proposed price + where actual payouts came from (compensation.view_all, read only) */
  compensationPreview: (id: string, priceCents: number) => api.get<any>('/owner/compensation/service-preview', { serviceId: id, priceCents: String(priceCents) }),
  /** SERVICE PRICING 08: how a service (+ add-ons, at its price or a proposed one) rings up for a walk-in — deals, tax, total; nothing charged */
  pricePreview: (id: string, q: { addOns?: string[]; priceCents?: number | null } = {}) => api.get<any>('/pos/checkout/price-preview', clean({ serviceId: id, addOns: q.addOns?.length ? q.addOns.join(',') : undefined, priceCents: q.priceCents == null ? undefined : String(q.priceCents) })),
  revertPricing: (id: string, b: Q) => api.post<any>(`${C}/services/${enc(id)}/pricing/revert`, b),
  schedulePricing: (id: string, b: Q) => api.post<any>(`${C}/services/${enc(id)}/pricing/schedule`, b),
  cancelScheduledPricing: (id: string, b: Q) => api.post<any>(`${C}/services/${enc(id)}/pricing/schedule/cancel`, b),
  history: (q: Q) => api.get<any>(`${C}/history`, clean(q)),
  customerHistory: (q: Q) => api.get<any>(`${C}/customer-history`, clean(q)),
  categorySummary: () => api.get<any>(`${C}/categories/summary`),
  categories: (q: Q) => api.get<any>(`${C}/categories`, clean(q)),
  category: (id: string, q: Q = {}) => api.get<any>(`${C}/categories/${enc(id)}`, clean(q)),
  reassign: (id: string, b: Q) => api.post<any>(`${C}/categories/${enc(id)}/reassign`, b),
  /** SERVICE PRICING 13: approve a review finding as is / reopen it (a note; the catalog itself never changes) */
  reviewDecision: (id: string, b: Q) => api.post<any>(`${C}/categories/${enc(id)}/review`, b),
  addOnSummary: () => api.get<any>(`${C}/add-ons/summary`),
  addOns: (q: Q) => api.get<any>(`${C}/add-ons`, clean(q)),
  addOn: (key: string) => api.get<any>(`${C}/add-ons/${enc(key)}`),
  addOnUsage: (q: Q) => api.get<any>(`${C}/add-ons/usage`, clean(q)),
  createAddOn: (b: Q) => api.post<any>(`${C}/add-ons`, b),
  updateAddOn: (key: string, b: Q) => api.patch<any>(`${C}/add-ons/${enc(key)}`, b),
  archiveAddOn: (key: string, b: Q = {}) => api.post<any>(`${C}/add-ons/${enc(key)}/archive`, b),
  restoreAddOn: (key: string, b: Q = {}) => api.post<any>(`${C}/add-ons/${enc(key)}/restore`, b),
};
