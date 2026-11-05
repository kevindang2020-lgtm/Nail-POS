// tech.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in tech.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const TechControllerListQueries = {
  schedule: { filters: { date: { type: 'date' } }, search: false },
  earningsCanonical: { filters: { period: { type: 'text' }, date: { type: 'date' }, dateTo: { type: 'date' }, payPeriodId: { type: 'uuid' } }, search: false },
  serviceHistory: { filters: { service: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
