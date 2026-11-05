// cash-drawer.pos.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in cash-drawer.pos.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const CashDrawerPosControllerListQueries = {
  get: { filters: { date: { type: 'date' }, registerId: { type: 'id' } }, search: false },
  movements: { filters: { date: { type: 'date' }, registerId: { type: 'id' } }, search: false },
  history: { filters: { registerId: { type: 'id' }, status: { type: 'enum', values: ['open', 'reconciled', 'discrepancy', 'cancelled', 'needs_review'] } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 400 }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
