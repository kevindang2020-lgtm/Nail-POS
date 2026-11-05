// community.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in community.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

const FEED_SPEC = {
  filters: { category: { type: 'text' }, severity: { type: 'text' }, region: { type: 'text' }, status: { type: 'text' }, followingOnly: { type: 'text' } },
  sorts: { newest: null, most_active: null, severity: null }, defaultSort: 'newest', sortParams: ['sort'], dirParams: [],
  params: ['page', 'offset'],
} satisfies ListQuerySpec;
const PAGED = { search: false, params: ['page', 'offset'] } satisfies ListQuerySpec;

export const CommunityControllerListQueries = {
  feed: FEED_SPEC,
  search: FEED_SPEC,
  mine: { ...PAGED, filters: { kind: { type: 'text' } } },
  incidents: { ...PAGED, filters: { scope: { type: 'text' } } },
} satisfies Record<string, ListQuerySpec>;
