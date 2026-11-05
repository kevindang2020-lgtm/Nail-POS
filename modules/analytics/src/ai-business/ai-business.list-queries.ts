// ai-business.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-business.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const AiBusinessControllerListQueries = {
  listMetrics: { filters: { category: { type: 'text' } }, search: false },
  appointmentMetrics: { filters: { preset: { type: 'text' } }, search: false },
  compareBranches: { filters: { preset: { type: 'text' } }, search: false },
  customerGrowth: { filters: { preset: { type: 'text' } }, search: false },
  technicianPerformance: { filters: { preset: { type: 'text' } }, search: false },
  dailyBrief: { filters: { preset: { type: 'text' } }, search: false },
  revenueSummary: { filters: { preset: { type: 'text' } }, search: false },
  revenueExplainChange: { filters: { preset: { type: 'text' }, comparePreset: { type: 'text' } }, search: false },
  freshness: { filters: { includesCurrentDay: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
