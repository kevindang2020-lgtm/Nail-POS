// audit.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in audit.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

// The audit feed — validated by the interceptor AND applied by the repository (audit.kysely.repository.ts): one
// declaration for the allow-list, the columns, the search columns and the range cap (a year interactively; larger ranges
// are an export).
export const AUDIT_EVENTS_SPEC = {
  filters: {
    module: { type: 'text', column: 'module' }, severity: { type: 'text', column: 'severity' }, status: { type: 'text', column: 'status' },
    actorUserId: { type: 'id', column: 'actor_user_id' }, resourceType: { type: 'text', column: 'resource_type' },
  },
  search: { params: ['search'], columns: ['action', 'module', 'summary', 'resource_id', 'actor_name'] },
  sorts: { occurredAt: 'occurred_at' }, defaultSort: '-occurredAt', tiebreaker: 'id',
  limitParams: ['pageSize'], maxLimit: 200, defaultLimit: 50, params: ['page'],
  dateRange: { maxDays: 'analytics', column: 'occurred_at' },
} satisfies ListQuerySpec;

export const AuditControllerListQueries = {
  events: AUDIT_EVENTS_SPEC,
} satisfies Record<string, ListQuerySpec>;

export const SuperAdminAuditControllerListQueries = {
  events: { ...AUDIT_EVENTS_SPEC, filters: { ...AUDIT_EVENTS_SPEC.filters, tenantId: { type: 'id' } } },
} satisfies Record<string, ListQuerySpec>;
