// tenant-activity.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in tenant-activity.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminTenantActivityControllerListQueries = {
  recent: { search: false },
  summary: { filters: { severity: { type: 'text' }, category: { type: 'text' }, tenantId: { type: 'id' }, eventType: { type: 'text' }, sortDirection: { type: 'enum', values: ['asc', 'desc'] } }, search: { params: ['search'] }, dirParams: [], dateRange: { maxDays: 'analytics' }, params: ['page'] },
  list: { filters: { severity: { type: 'text' }, category: { type: 'text' }, tenantId: { type: 'id' }, eventType: { type: 'text' }, sortDirection: { type: 'enum', values: ['asc', 'desc'] } }, search: { params: ['search'] }, dirParams: [], dateRange: { maxDays: 'analytics' }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
