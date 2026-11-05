// posSearchApi.ts — tenant POS global search client. Hits the ONE secure endpoint /pos/search; the server
// derives tenant/branch from the session (we never send tenantId/branchId). Results are grouped + safe.
import { api } from './client';

export type SearchGroupKey = 'customers' | 'appointments' | 'queue' | 'tickets' | 'receipts' | 'technicians' | 'services';
export interface SearchHit { id: string; type: string; title: string; subtitle?: string; badge?: string; route?: string }
export interface SearchResponse {
  ok: boolean; query: string;
  scope: { tenant: string; location: string };
  groups: Record<SearchGroupKey, SearchHit[]>;
  counts: Record<SearchGroupKey, number>;
  totalCount: number; requestId: string;
}

export const posSearchApi = {
  global: (q: string, opts?: { allLocations?: boolean; limit?: number }) =>
    api.get<SearchResponse>('/pos/search', {
      q,
      ...(opts?.allLocations ? { locationScope: 'all' } : {}),
      ...(opts?.limit ? { limit: opts.limit } : {}),
    }),
  recordOpen: (resultType: string, entityId: string, q: string) =>
    api.post('/pos/search/open', { resultType, entityId, q }),
};
