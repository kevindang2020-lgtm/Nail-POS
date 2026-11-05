// super-admin-loyalty.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-loyalty.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminLoyaltyControllerListQueries = {
  overview: { filters: { status: { type: 'text' } }, search: { params: ['search'] } },
  dashboard_: { filters: { centsPerPoint: { type: 'number' } }, search: false },
  suspiciousList: { filters: { status: { type: 'text' } }, search: false },
  correctionsList: { filters: { status: { type: 'text' } }, search: false },
  export: { filters: { centsPerPoint: { type: 'number' } }, search: false },
  exportXlsx: { filters: { centsPerPoint: { type: 'number' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
