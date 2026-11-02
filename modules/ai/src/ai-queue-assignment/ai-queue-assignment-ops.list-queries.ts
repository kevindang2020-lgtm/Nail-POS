// ai-queue-assignment-ops.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-queue-assignment-ops.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const QueueAssignmentOpsControllerListQueries = {
  versions: { filters: { scope: { type: 'text' } }, search: false },
  listAlerts: { filters: { status: { type: 'text' }, type: { type: 'text' } }, search: false },
  analytics: { search: false, dateRange: { maxDays: 92 } },
  exportCsv: { filters: { type: { type: 'text' } }, search: false, dateRange: { maxDays: 92 } },
  usage: { search: false, dateRange: { maxDays: 92 } },
} satisfies Record<string, ListQuerySpec>;
