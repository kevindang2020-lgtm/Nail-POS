// super-admin-merchant-accounts.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-merchant-accounts.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminMerchantAccountsControllerListQueries = {
  overview: { filters: { tenantId: { type: 'id' }, selected: { type: 'text' } }, search: { params: ['search'] } },
  list: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  export: { filters: { tenantId: { type: 'id' } }, search: { params: ['search'] } },
} satisfies Record<string, ListQuerySpec>;
