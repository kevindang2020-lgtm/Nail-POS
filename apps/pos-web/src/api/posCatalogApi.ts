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
  revertPricing: (id: string, b: Q) => api.post<any>(`${C}/services/${enc(id)}/pricing/revert`, b),
  history: (q: Q) => api.get<any>(`${C}/history`, clean(q)),
  customerHistory: (q: Q) => api.get<any>(`${C}/customer-history`, clean(q)),
  categorySummary: () => api.get<any>(`${C}/categories/summary`),
  categories: (q: Q) => api.get<any>(`${C}/categories`, clean(q)),
  category: (id: string, q: Q = {}) => api.get<any>(`${C}/categories/${enc(id)}`, clean(q)),
  reassign: (id: string, b: Q) => api.post<any>(`${C}/categories/${enc(id)}/reassign`, b),
  addOnSummary: () => api.get<any>(`${C}/add-ons/summary`),
  addOns: (q: Q) => api.get<any>(`${C}/add-ons`, clean(q)),
  addOn: (key: string) => api.get<any>(`${C}/add-ons/${enc(key)}`),
  addOnUsage: (q: Q) => api.get<any>(`${C}/add-ons/usage`, clean(q)),
  createAddOn: (b: Q) => api.post<any>(`${C}/add-ons`, b),
  updateAddOn: (key: string, b: Q) => api.patch<any>(`${C}/add-ons/${enc(key)}`, b),
  archiveAddOn: (key: string, b: Q = {}) => api.post<any>(`${C}/add-ons/${enc(key)}/archive`, b),
  restoreAddOn: (key: string, b: Q = {}) => api.post<any>(`${C}/add-ons/${enc(key)}/restore`, b),
};
