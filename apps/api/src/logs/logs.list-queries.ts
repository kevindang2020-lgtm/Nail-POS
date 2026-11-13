// logs.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in logs.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const LogsControllerListQueries = {
  list: { filters: { category: { type: 'text' }, severity: { type: 'text' }, source: { type: 'text' }, relatedId: { type: 'text' }, correlationId: { type: 'text' } }, search: { params: ['search'] }, dateRange: { maxDays: 3660 }, maxLimit: 100, defaultLimit: 25, params: ['page', 'pageSize', 'limit'] },
  // Device Integration Logs 08: the sanitized export — the same filters, one bounded range
  exportCsv: { filters: { category: { type: 'text' }, severity: { type: 'text' }, source: { type: 'text' }, relatedId: { type: 'text' }, correlationId: { type: 'text' } }, search: { params: ['search'] }, dateRange: { maxDays: 31 } },
  // Device Integration Logs 09: the retry stores' rows, numbered pages only
  retries: { filters: {}, maxLimit: 50, defaultLimit: 10, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
