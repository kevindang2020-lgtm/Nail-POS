// alerts.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in alerts.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminAlertsControllerListQueries = {
  recent: { search: false },
  list: { filters: { severity: { type: 'text' }, type: { type: 'text' }, status: { type: 'text' }, tenantId: { type: 'id' } }, search: { params: ['search'] }, sorts: { createdAt: null, severity: null, type: null, status: null }, defaultSort: '-createdAt', sortParams: ['sortBy'], dirParams: ['sortDirection'], unsignedDirection: 'desc', legacySort: { by: 'sortBy', dir: 'sortDirection' }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
