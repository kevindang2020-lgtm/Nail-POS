// nail-showcase.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in nail-showcase.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const NailShowcaseCustomerControllerListQueries = {
  feed: { filters: { scope: { type: 'text' }, salonId: { type: 'id' }, branchId: { type: 'id' }, serviceId: { type: 'id' }, technicianId: { type: 'id' }, tag: { type: 'text' } }, search: false, sorts: { newest: null, most_liked: null, most_commented: null, trending: null }, defaultSort: 'newest', sortParams: ['sort'], dirParams: [], maxLimit: 50 },
} satisfies Record<string, ListQuerySpec>;
