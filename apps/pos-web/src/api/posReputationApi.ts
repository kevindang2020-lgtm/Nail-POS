// posReputationApi — AI Center → AI Review & Reputation (/pos/reputation/*): the read side of the eight-tab workspace
// (Review & Reputation guide, Nov 1 2026) — the six cards with one definition, the inbox and a review's full detail, the
// approval / complaint / request queues, monthly trends, branch comparison, integrations and the read-only check. The
// workflow writes (draft · approval · publish · notes · complaint actions) stay on posAiReviewReputationApi.
import { api } from './client';
const enc = encodeURIComponent;
type Q = Record<string, string | number | undefined>;
const clean = (o: Q) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posReputationApi = {
  summary: (q: Q = {}) => api.get<any>(`/pos/reputation/summary`, clean(q)),
  reviews: (q: Q = {}) => api.get<any>(`/pos/reputation/reviews`, clean(q)),
  review: (id: string) => api.get<any>(`/pos/reputation/reviews/${enc(id)}`),
  approvals: (q: Q = {}) => api.get<any>(`/pos/reputation/approvals`, clean(q)),
  complaints: (q: Q = {}) => api.get<any>(`/pos/reputation/complaints`, clean(q)),
  trends: (q: Q = {}) => api.get<any>(`/pos/reputation/trends`, clean(q)),
  branches: (q: Q = {}) => api.get<any>(`/pos/reputation/branches`, clean(q)),
  requests: (q: Q = {}) => api.get<any>(`/pos/reputation/requests`, clean(q)),
  integrations: () => api.get<any>(`/pos/reputation/integrations`),
  check: () => api.post<any>(`/pos/reputation/check`, {}),
};
