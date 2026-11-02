// dashboard.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in dashboard.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const DashboardControllerListQueries = {
  state: { filters: { shape: { type: 'text' }, date: { type: 'date' }, range: { type: 'text' } }, search: false },
  kpis: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  operations: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  appointments: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  queue: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  serving: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  checkout: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  revenueTrend: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  topServices: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  topTechnicians: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  paymentMix: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  customers: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  insights: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
  alerts: { filters: { date: { type: 'date' }, range: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
