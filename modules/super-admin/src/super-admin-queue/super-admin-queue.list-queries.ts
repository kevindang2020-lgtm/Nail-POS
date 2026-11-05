// super-admin-queue.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-queue.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

const LIVE_QUEUE_SPEC = {
  filters: { status: { type: 'text' }, tenantId: { type: 'id' }, branchId: { type: 'id' } },
  search: { params: ['search'] },
  sorts: { queueId: 'q.id', customer: 'q.customer_name', tenant: 't.display_name', branch: 'b.name', status: 'q.status', technician: 'tech.full_name', service: null, updated: 'q.updated_at', wait: 'q.checked_in_at' },
  defaultSort: '-wait', sortParams: ['sort'], dirParams: ['direction'], unsignedDirection: 'desc', legacySort: { by: 'sort', dir: 'direction' },
  limitParams: ['pageSize'], params: ['page', 'supportTenantId'],   // supportTenantId: support-mode unmask (queue-pii-mask.ts)
} satisfies ListQuerySpec;

export const SuperAdminQueueControllerListQueries = {
  overview: { filters: { status: { type: 'text' } }, search: { params: ['search'] }, params: ['limit', 'supportTenantId'] },
  liveOverview: LIVE_QUEUE_SPEC,
  export: LIVE_QUEUE_SPEC,
  exportXlsx: LIVE_QUEUE_SPEC,
  exportPdf: LIVE_QUEUE_SPEC,
} satisfies Record<string, ListQuerySpec>;
