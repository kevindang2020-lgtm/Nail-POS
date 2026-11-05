// inventory.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in inventory.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const InventoryControllerListQueries = {
  products: { filters: { categoryId: { type: 'id' }, brandId: { type: 'id' } }, search: { params: ['search'] } },
  reports: { filters: { status: { type: 'text' } }, search: false },
  listPOs: { filters: { status: { type: 'text' } }, search: false },
  listCounts: { filters: { status: { type: 'text' } }, search: false },
  listAlerts: { filters: { includeAcknowledged: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
