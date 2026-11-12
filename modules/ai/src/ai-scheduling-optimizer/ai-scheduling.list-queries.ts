// ai-scheduling.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-scheduling.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const AiSchedulingControllerListQueries = {
  list: { filters: { status: { type: 'text' }, type: { type: 'text' }, runId: { type: 'id' }, technicianId: { type: 'id' }, date: { type: 'date' } }, search: false },
  listOwn: { filters: { status: { type: 'text' }, date: { type: 'date' } }, search: false },
  runs: { filters: { date: { type: 'date' } }, search: false },
  calendar: { filters: { date: { type: 'date' } }, search: false, params: ['capacity'] },
  timeOff: { filters: { technicianId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics' } },
} satisfies Record<string, ListQuerySpec>;
