// posSegmentsApi — Marketing & Growth → Customer Segments (/pos/marketing/segments/*). Customer Segments Complete Build Guide
// (Oct 30 2026): server-side segment counts and members (search, filters, date basis, numbered pages), Why This Segment?,
// the customer history & marketing overlay (masked, audited), stored historical snapshots, and the Audience Builder —
// an UNSENT audience draft handed to Campaign Center (nothing here sends). Tenant and branch come from the session.
import { api } from './client';
const enc = encodeURIComponent;
export type SegmentQuery = {
  segment?: string; q?: string; sort?: string; page?: number; pageSize?: number; branch?: string; preset?: string; from?: string; to?: string; basis?: string;
  minVisits?: number; maxVisits?: number; minSpend?: number; maxSpend?: number; tier?: string; service?: string; sms?: string; email?: string;
};
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posSegmentsApi = {
  summary: (p: Pick<SegmentQuery, 'preset' | 'from' | 'to' | 'branch'> = {}) => api.get<any>(`/pos/marketing/segments/summary`, clean(p)),
  members: (q: SegmentQuery) => api.get<any>(`/pos/marketing/segments/members`, clean(q)),
  qualification: (id: string) => api.get<any>(`/pos/marketing/segments/customers/${enc(id)}/qualification`),
  overlay: (id: string) => api.get<any>(`/pos/marketing/segments/customers/${enc(id)}`),
  snapshotDay: (date: string) => api.get<any>(`/pos/marketing/segments/snapshots/day`, { date }),
  createDraft: (b: { channel: 'sms' | 'email'; purpose: 'general' | 'win_back'; selectionMode: 'page' | 'selected' | 'all_matching'; customerIds?: string[] | null; filters: SegmentQuery; message?: string | null; idempotencyKey: string }) =>
    api.post<any>(`/pos/marketing/segments/audience-drafts`, { ...b, filters: clean(b.filters) } as Record<string, unknown>),
  draft: (id: string) => api.get<any>(`/pos/marketing/segments/audience-drafts/${enc(id)}`),
  recheck: (id: string) => api.post<any>(`/pos/marketing/segments/audience-drafts/${enc(id)}/recheck`, {}),
  discard: (id: string) => api.post<any>(`/pos/marketing/segments/audience-drafts/${enc(id)}/discard`, {}),
  linkCampaign: (id: string, campaignId: string) => api.post<any>(`/pos/marketing/segments/audience-drafts/${enc(id)}/campaign`, { campaignId }),
};
