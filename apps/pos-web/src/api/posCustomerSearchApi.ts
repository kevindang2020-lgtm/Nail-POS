// posCustomerSearchApi — AI Center → Customer Profile → Customer Search (/pos/customer-search/*). Customer Search Complete Build
// Guide (Nov 1 2026): server search (name · phone · email · customer / appointment / ticket id, relevance-ranked; the directory
// newest-first without a term), status / booking / technician / service / branch filters, a date field + From/To range,
// pages 10/25/50/100, the audited Customer 360° overlay and the read-only Check Customer Search System. Tenant / branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type CustomerSearchQuery = {
  q?: string; status?: string; booking?: string; technician?: string; service?: string; branch?: string;
  dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number;
};
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posCustomerSearchApi = {
  summary: (r?: { branch?: string; preset?: string; from?: string; to?: string }) => api.get<any>(`/pos/customer-search/summary`, clean(r ?? {})),
  customers: (q: CustomerSearchQuery) => api.get<any>(`/pos/customer-search/customers`, clean(q)),
  options: () => api.get<any>(`/pos/customer-search/options`),
  profile: (id: string) => api.get<any>(`/pos/customer-search/customers/${enc(id)}`),
  check: () => api.post<any>(`/pos/customer-search/check`, {}),
};
