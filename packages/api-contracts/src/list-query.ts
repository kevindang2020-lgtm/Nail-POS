// list-query.ts — Constitution 5 §47–§52 (BUILD_PLAN Phase 12, DoD #21 / #22 / #23): the ONE wire syntax every list
// endpoint accepts for filtering, sorting, search, paging and date ranges, shared by apps/api and every app.
//
//   GET /pos/customers?q=ann&filter[status]=active&filter[segment]=vip,regular&sort=-createdAt,name&limit=50
//   GET /owner/reports/sales?from=2026-09-01&to=2026-09-30           (date-only bounds: the branch's own calendar day)
//   GET /pos/audit?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z  (instants)
//
// Rules (enforced server-side by parseListQuery in @aipowersalon/database, declared per endpoint with @ListQuery(spec) or
// @ListQueries({ handler: spec }) and applied by the global ListQueryInterceptor in apps/api/src/common/list-query):
//   - filter[field]   only the fields the endpoint declares; an unknown one is 400 INVALID_FILTER (§49). A list value is
//                     `a,b` or a repeated parameter. Each endpoint's older plain parameters (`?status=active`) keep
//                     working — they are the same allow-listed filters under their legacy names.
//   - sort            `field`, `-field` (descending), or `a,-b`; only declared fields, else 400 INVALID_SORT (§50).
//                     `?sort=field&dir=desc` (the older pair) means the same as `?sort=-field`.
//   - q               free-text search, tenant-scoped before retrieval (§51).
//   - limit / cursor  page size (clamped to the endpoint's maximum, §47) and the opaque nextCursor (§45).
//   - from / to       ISO dates (YYYY-MM-DD) or instants; a span longer than the endpoint's maxDays is 400
//                     DATE_RANGE_TOO_LARGE — use the async export for more (§52). Inverted / unparseable → INVALID_FILTER.
//   - Any other top-level query parameter the endpoint does not read is ignored (consistently, §49): cache-busters,
//     `async=1`, tracking parameters must never turn a working screen into an error.
//
// Browser-safe and dependency-free (package rule §111).

export type ListFilterValue = string | number | boolean | Array<string | number>;
export type ListSortDirection = 'asc' | 'desc';

/** The request half of a list call. Every field is optional; the endpoint's defaults apply for the rest. */
export interface ListQuery {
  q?: string;
  filter?: Record<string, ListFilterValue>;
  /** 'field' | '-field' | 'a,-b' */
  sort?: string;
  cursor?: string;
  limit?: number;
  /** YYYY-MM-DD (branch calendar day) or an ISO instant */
  from?: string;
  to?: string;
}

/** The response half: a keyset page (§45). Offset-paged endpoints also return nextCursor (the bridge). */
export interface ListPage<T> { items: T[]; nextCursor: string | null; hasMore: boolean }

/** The error codes a list query can produce (registered in ERROR_REGISTRY). */
export const LIST_QUERY_ERROR_CODES = ['INVALID_FILTER', 'INVALID_SORT', 'DATE_RANGE_TOO_LARGE'] as const;
export type ListQueryErrorCode = typeof LIST_QUERY_ERROR_CODES[number];

/** Details the server attaches to a list-query error so a screen can point at the offending control. */
export interface ListQueryErrorDetails { field?: string; allowed?: string[]; maxDays?: number }

const enc = encodeURIComponent;
/**
 * Build the query string for a ListQuery (no leading '?'). Filters become `filter[field]=…`; arrays are comma-joined.
 * Empty / null values are dropped so a screen can pass its whole filter state.
 */
export function listQueryString(q: ListQuery): string {
  const parts: string[] = [];
  const push = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${enc(String(v))}`); };
  push('q', q.q);
  for (const [k, v] of Object.entries(q.filter ?? {})) {
    if (Array.isArray(v)) { if (v.length) push(`filter%5B${enc(k)}%5D`, v.join(',')); } else push(`filter%5B${enc(k)}%5D`, v);
  }
  push('sort', q.sort); push('cursor', q.cursor); push('limit', q.limit); push('from', q.from); push('to', q.to);
  return parts.join('&');
}
