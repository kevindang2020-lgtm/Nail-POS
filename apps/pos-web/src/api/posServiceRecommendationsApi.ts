// posServiceRecommendationsApi — AI Center → Customer Profile → Service Recommendations (/pos/service-recommendations/*).
// Service Recommendations guide (Nov 1 2026): the cards, the queue (tab · type · search · service · technician · date
// dimension + range · sort · pages 10/25/50/100, newest first), the 360° overlay (audited, live catalog), the review workflow
// (reviewed · deferred · not applicable · reopened · note), the Booking Assistant handoff (prefill only — never an
// appointment), activity, evaluation history, Refresh (one bounded evaluation) and the read-only check.
import { api } from './client';
const enc = encodeURIComponent;
export type RecommendationQuery = { q?: string; tab?: string; type?: string; serviceId?: string; technicianId?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posServiceRecommendationsApi = {
  summary: () => api.get<any>(`/pos/service-recommendations/summary`),
  list: (q: RecommendationQuery) => api.get<any>(`/pos/service-recommendations/recommendations`, clean(q)),
  detail: (id: string) => api.get<any>(`/pos/service-recommendations/recommendations/${enc(id)}`),
  review: (id: string, body: { action: string; note?: string; dueOn?: string; expectedVersion?: number }) => api.post<any>(`/pos/service-recommendations/recommendations/${enc(id)}/review`, clean(body)),
  handoff: (id: string, body: { technicianId?: string }) => api.post<any>(`/pos/service-recommendations/recommendations/${enc(id)}/handoff`, clean(body)),
  history: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/service-recommendations/history`, clean(q)),
  scans: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/service-recommendations/scans`, clean(q)),
  refresh: () => api.post<any>(`/pos/service-recommendations/scan`, {}),
  check: () => api.post<any>(`/pos/service-recommendations/check`, {}),
};
