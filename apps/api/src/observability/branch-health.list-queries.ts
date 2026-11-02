// branch-health.list-queries.ts — BUILD_PLAN Phase 14 B: the declared filters / sorts of GET /super-admin/branch-health
// (Constitution 5 §47–§52). Same shape as the salon-health list: status filter, worst / name / observed sorts, limit ≤ 500.
import type { ListQuerySpec } from '@aipowersalon/database';

export const BranchHealthListControllerListQueries = {
  list: { filters: { status: { type: 'text' } }, search: false, sorts: { worst: null, name: null, observed: null }, defaultSort: 'worst', sortParams: ['sort'], dirParams: [], maxLimit: 500 },
} satisfies Record<string, ListQuerySpec>;
