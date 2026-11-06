// posReviewsCenterApi — Marketing & Growth → Reviews (/pos/reviews-center/*). Reviews & Reputation guide (Oct 30 2026): KPIs that
// state their scope (verified / all received / public), the server-side Review Feed (search · filters · date basis + range · sort ·
// pages 10/20/50), the overlay (review / customer / technician / visit / reply history / moderation trail), reason-coded Hide /
// Unhide with version + request key, the assistant's facts and the read-only Check Review System. Tenant/branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type ReviewQuery = {
  q?: string; rating?: string; comment?: string; visibility?: string; followup?: string; assignee?: string; technician?: string; service?: string; source?: string;
  basis?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number;
};
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posReviewsCenterApi = {
  summary: (r?: { preset?: string; from?: string; to?: string; technician?: string; source?: string }) => api.get<any>(`/pos/reviews-center/summary`, clean(r ?? {})),
  reviews: (q: ReviewQuery) => api.get<any>(`/pos/reviews-center/reviews`, clean(q)),
  options: () => api.get<any>(`/pos/reviews-center/options`),
  review: (id: string) => api.get<any>(`/pos/reviews-center/reviews/${enc(id)}`),
  moderate: (id: string, b: { action: 'hide' | 'unhide'; reasonCode?: string | null; reasonText?: string | null; evidence?: string | null; expectedVersion: number; idempotencyKey: string }) =>
    api.post<any>(`/pos/reviews-center/reviews/${enc(id)}/moderate`, b),
  insights: (r?: { preset?: string; from?: string; to?: string }) => api.get<any>(`/pos/reviews-center/insights`, clean(r ?? {})),
  check: () => api.get<any>(`/pos/reviews-center/check`),
  /** A17 Nov 6: recorded check run, the last run, staff, assignment */
  checkRun: () => api.post<any>(`/pos/reviews-center/check/run`, {}),
  checkLast: () => api.get<any>(`/pos/reviews-center/check/last`),
  staff: () => api.get<{ items: { id: string; name: string; role: string }[] }>(`/pos/reviews-center/staff`),
  assign: (id: string, assignedUserId: string | null) => api.post<{ id: string; assignedUserId: string | null }>(`/pos/reviews-center/reviews/${enc(id)}/assign`, { assignedUserId }),
};
