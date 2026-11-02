// super-admin-staff.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-staff.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminStaffControllerListQueries = {
  overview: { filters: { status: { type: 'text' } }, search: { params: ['search'] } },
  workforceDirectory: { filters: { role: { type: 'text', aliases: ['role', 'roleCategory'] }, tenantId: { type: 'id' }, branchId: { type: 'id' }, status: { type: 'text' } }, search: { params: ['search'] }, sorts: { name: null, role: null, tenantName: null, branchName: null, status: null, lastActivity: null, createdAt: null }, defaultSort: 'name', sortParams: ['sort'], dirParams: ['dir'], legacySort: { by: 'sort', dir: 'dir' }, limitParams: ['pageSize'], maxLimit: 100, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
