// posChurnWatchApi — AI Center → Customer Profile → Churn Watch (/pos/churn-watch/*). Churn Watch guide (Nov 1 2026): the six
// metrics, the review queue (tab · priority · search · date field + range · sort · pages 10/25/50/100), the Retention Evidence
// overlay (audited), the internal review workflow (reviewed · deferred · reopened · note), history and the read-only check.
// Refresh is the shared Customer Intelligence scan. Tenant / branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type ChurnQuery = { q?: string; tab?: string; priority?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posChurnWatchApi = {
  summary: () => api.get<any>(`/pos/churn-watch/summary`),
  customers: (q: ChurnQuery) => api.get<any>(`/pos/churn-watch/customers`, clean(q)),
  customer: (id: string) => api.get<any>(`/pos/churn-watch/customers/${enc(id)}`),
  review: (id: string, body: { action: string; note?: string; dueOn?: string; expectedVersion?: number }) => api.post<any>(`/pos/churn-watch/customers/${enc(id)}/review`, clean(body)),
  history: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/churn-watch/history`, clean(q)),
  check: () => api.post<any>(`/pos/churn-watch/check`, {}),
  refresh: () => api.post<any>(`/pos/customer-intelligence/scan`, {}),
};
