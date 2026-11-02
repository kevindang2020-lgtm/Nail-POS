// ai-review-reputation.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-review-reputation.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

// the review inbox — validated by the interceptor AND applied by the repository (ai-review-reputation kysely inbox)
export const REVIEW_INBOX_SPEC = {
  filters: { source: { type: 'text', column: 'source' }, sentiment: { type: 'text', column: 'sentiment' }, status: { type: 'text', column: 'response_status' } },
  search: false, sorts: { createdAt: 'created_at' }, defaultSort: '-createdAt', tiebreaker: 'id',
  limitParams: ['pageSize'], maxLimit: 100, defaultLimit: 25, params: ['page'],
} satisfies ListQuerySpec;

export const AiReviewReputationControllerListQueries = {
  inbox: REVIEW_INBOX_SPEC,
  analytics: { filters: { branchId: { type: 'id' }, prevFrom: { type: 'date' }, prevTo: { type: 'date' } }, search: false, dateRange: { maxDays: 'analytics' } },
  branchComparison: { search: false, dateRange: { maxDays: 'analytics' } },
} satisfies Record<string, ListQuerySpec>;
