// communications.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in communications.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

// The message threads list — validated by the interceptor AND applied by the repository (communications.kysely.repository.ts).
export const THREADS_SPEC = {
  filters: {
    status: { type: 'text', column: 'status' }, channel: { type: 'text', column: 'channel' }, assignedTo: { type: 'text', column: 'assigned_to' },
    unreadOnly: { type: 'text' },   // a count comparison — applied by the repository itself
  },
  search: { params: ['search'], columns: ['customer_name', 'customer_contact', 'subject', 'last_message_preview'] },
  limitParams: ['pageSize'], maxLimit: 200, defaultLimit: 50, params: ['page'],
} satisfies ListQuerySpec;

export const CommunicationsControllerListQueries = {
  state: THREADS_SPEC,
  activity: { search: false, dateRange: { maxDays: 'analytics', days: ['days'] } },
} satisfies Record<string, ListQuerySpec>;

export const SuperAdminCommunicationsControllerListQueries = {
  state: { ...THREADS_SPEC, filters: { ...THREADS_SPEC.filters, tenantId: { type: 'id' } } },
  overviewState: { filters: { tenantId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics', days: ['days'] } },
} satisfies Record<string, ListQuerySpec>;
