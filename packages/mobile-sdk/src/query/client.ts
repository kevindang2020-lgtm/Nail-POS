// client.ts — the ONE QueryClient factory for the four mobile apps (Constitution 6 §24–25).
//  • reads are 'offlineFirst': a cached read renders while offline and the fetch is attempted once;
//  • retries belong to the transport (GET-only, jittered — §14), so the query layer never retries on top of it, and a
//    mutation is never retried here at all (the journal replays it with its Idempotency-Key);
//  • gcTime is a day so a restored cache survives until the screen asks for it;
//  • no refetch on focus — realtime invalidation + the safety sync keep screens current (Smooth Refresh spec).
import { QueryClient } from '@tanstack/react-query';

export const QUERY_GC_MS = 24 * 3600_000;
export const QUERY_STALE_MS = 15_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'offlineFirst', retry: false, staleTime: QUERY_STALE_MS, gcTime: QUERY_GC_MS, refetchOnWindowFocus: false },
      mutations: { networkMode: 'always', retry: false },
    },
  });
}
