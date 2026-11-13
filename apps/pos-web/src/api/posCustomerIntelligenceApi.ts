// posCustomerIntelligenceApi — AI Center → Customer Intelligence (/pos/customer-intelligence/*). Customer Intelligence guide
// (Nov 1 2026): the six cards + their reconciliation, Refresh (rate-limited scan), the authorized customer list (search · status ·
// flag · date field + range · sort · pages 10/25/50/100), one customer's classification + evidence (audited), scan history and
// the read-only Check Customer Intelligence System. Tenant / branch: the session.
import { api } from './client';
import type { Customer360 } from '@aipowersalon/api-contracts/tenant';
const enc = encodeURIComponent;
export type IntelligenceQuery = { q?: string; branch?: string; status?: string; flag?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posCustomerIntelligenceApi = {
  summary: () => api.get<any>(`/pos/customer-intelligence/summary`),
  scan: () => api.post<any>(`/pos/customer-intelligence/scan`, {}),
  customers: (q: IntelligenceQuery) => api.get<any>(`/pos/customer-intelligence/customers`, clean(q)),
  customer: (id: string) => api.get<any>(`/pos/customer-intelligence/customers/${enc(id)}`),
  // Customer Intelligence 30: the 360-degree view (identity · history · preferences · loyalty · evidence-backed review suggestions)
  customer360: (id: string) => api.get<Customer360>(`/pos/customer-intelligence/customers/${enc(id)}/360`),
  scans: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/customer-intelligence/scans`, clean(q)),
  check: () => api.post<any>(`/pos/customer-intelligence/check`, {}),
};
