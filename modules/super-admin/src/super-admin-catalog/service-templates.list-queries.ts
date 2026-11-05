// service-templates.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in service-templates.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const ServiceTemplatesControllerListQueries = {
  list: { filters: { category: { type: 'text' }, status: { type: 'text' }, commission: { type: 'text' }, tax: { type: 'text' }, usage: { type: 'text' }, serviceType: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  export: { filters: { category: { type: 'text' }, status: { type: 'text' }, commission: { type: 'text' }, tax: { type: 'text' }, usage: { type: 'text' }, serviceType: { type: 'text' } }, search: { params: ['search'] } },
  deployPreview: { filters: { allowOverwrite: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
