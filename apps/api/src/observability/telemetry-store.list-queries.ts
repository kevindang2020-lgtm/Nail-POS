// telemetry-store.list-queries.ts — BUILD_PLAN Phase 14 A (Constitution 5 §47–§52): the declared filters and the date-range cap
// of the telemetry search lists (telemetry-store.ts). The range is capped at the store's retention (14 days); with no bound the
// service searches the last 24 hours. Every value reaches SQL as a bound parameter (the service re-validates the id shapes).
import type { ListQuerySpec } from '@aipowersalon/database';

const FILTERS = {
  requestId: { type: 'id' }, correlationId: { type: 'id' }, traceId: { type: 'id' }, tenantId: { type: 'uuid' },
  route: { type: 'text', maxLength: 300 }, status: { type: 'text', maxLength: 3 },
  level: { type: 'enum', values: ['info', 'warn', 'error', 'fatal'] },
} as const;

export const TelemetrySearchControllerListQueries = {
  requests: { filters: FILTERS, search: { maxLength: 200 }, maxLimit: 200, defaultLimit: 50, dateRange: { maxDays: 14 } },
  logs: { filters: FILTERS, search: { maxLength: 200 }, maxLimit: 500, defaultLimit: 100, dateRange: { maxDays: 14 } },
} satisfies Record<string, ListQuerySpec>;
