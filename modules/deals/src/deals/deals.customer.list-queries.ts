// deals.customer.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in deals.customer.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const DealsCustomerControllerListQueries = {
  nearby: { filters: { lat: { type: 'number', min: -90, max: 90 }, lng: { type: 'number', min: -180, max: 180 }, radiusMiles: { type: 'number', min: 0 }, ownerType: { type: 'text' }, maxPriceCents: { type: 'number', min: 0 }, categoryId: { type: 'id' } }, sorts: { nearest: null, best_value: null, ending_soon: null, newest: null }, defaultSort: 'nearest', sortParams: ['sort'], dirParams: [] },
} satisfies Record<string, ListQuerySpec>;
