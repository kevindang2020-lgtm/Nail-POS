// ai-analytics-forecasting.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in ai-analytics-forecasting.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const AiAnalyticsForecastingControllerListQueries = {
  businessAnomalies: { search: false, dateRange: { maxDays: 'analytics', days: ['windowDays'] } },
  productForecast: { filters: { horizonDays: { type: 'number' } }, search: false },
  noShowRisk: { search: false, dateRange: { maxDays: 'analytics', days: ['days'] } },
  appointmentForecast: { filters: { horizonDays: { type: 'number' } }, search: false },
  revenueForecast: { filters: { horizonDays: { type: 'number' } }, search: false },
  serviceDemandForecast: { filters: { horizonDays: { type: 'number' } }, search: false },
  accuracy: { filters: { domain: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
