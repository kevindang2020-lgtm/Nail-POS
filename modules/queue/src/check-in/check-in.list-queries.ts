// check-in.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in check-in.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const CheckInControllerListQueries = {
  state: { filters: { source: { type: 'text' }, status: { type: 'text' }, technicianId: { type: 'id' }, branchId: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  recent: { filters: { source: { type: 'text' }, status: { type: 'text' }, technicianId: { type: 'id' }, branchId: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  customerSearch: { search: { params: ['query'] } },
  appointmentSearch: { filters: { date: { type: 'date' } }, search: { params: ['query'] } },
  waitEstimate: { filters: { serviceIds: { type: 'id', multi: true }, technicianId: { type: 'id' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
