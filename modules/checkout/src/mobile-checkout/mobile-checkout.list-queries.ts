// mobile-checkout.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in mobile-checkout.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const MobileCheckoutControllerListQueries = {
  readiness: { filters: { deviceId: { type: 'id' } }, search: false },
  queue: { filters: { status: { type: 'enum', values: ['all', 'ready', 'in_progress', 'failed', 'paid'], aliases: ['status', 'filter'] } }, search: { params: ['search'] }, sorts: { oldest: null, newest: null, amount_desc: null, customer: null }, defaultSort: 'oldest', sortParams: ['sort'], dirParams: [] },
  retailCatalog: { search: { params: ['search'] } },
  lockStatus: { filters: { sessionId: { type: 'text' } }, search: false },
  previewRefundSplit: { filters: { amountCents: { type: 'number' } }, search: false },
  reports: { filters: { period: { type: 'text' } }, search: false },
  // Owner & Manager Payment App mandate (wave 3 / TTP)
  capability: { filters: { deviceId: { type: 'id' } }, search: false },
  ticket: { filters: { sessionId: { type: 'text' } }, search: false },
  payments: { filters: { from: { type: 'text' }, to: { type: 'text' }, status: { type: 'text' }, method: { type: 'text' }, employeeId: { type: 'id' }, deviceId: { type: 'id' }, branchId: { type: 'id' }, surface: { type: 'text' }, limit: { type: 'number' } }, search: false },
  salesReport: { filters: { period: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
