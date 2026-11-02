// super-admin-hardware-packages.module.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-hardware-packages.module.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const HardwarePackagesControllerListQueries = {
  state: { filters: { status: { type: 'text' }, paymentStatus: { type: 'text' }, packageType: { type: 'text' }, carrier: { type: 'text' }, tenantId: { type: 'id' } }, search: { params: ['search'] }, sorts: { updatedAt: null, createdAt: null, salonName: null, status: null, paymentStatus: null }, defaultSort: '-updatedAt', sortParams: ['sortBy'], dirParams: ['sortDirection'], unsignedDirection: 'desc', legacySort: { by: 'sortBy', dir: 'sortDirection' }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] }, params: ['page'] },
  activity: { search: false },
  events: { search: false },
  tenants: { search: { params: ['search'] } },
  export: { filters: { status: { type: 'text' }, paymentStatus: { type: 'text' }, packageType: { type: 'text' }, carrier: { type: 'text' }, tenantId: { type: 'id' } }, search: { params: ['search'] }, sorts: { updatedAt: null, createdAt: null, salonName: null, status: null, paymentStatus: null }, defaultSort: '-updatedAt', sortParams: ['sortBy'], dirParams: ['sortDirection'], unsignedDirection: 'desc', legacySort: { by: 'sortBy', dir: 'sortDirection' }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] }, params: ['page'] },
  list: { filters: { status: { type: 'text' }, paymentStatus: { type: 'text' }, packageType: { type: 'text' }, carrier: { type: 'text' }, tenantId: { type: 'id' } }, search: { params: ['search'] }, sorts: { updatedAt: null, createdAt: null, salonName: null, status: null, paymentStatus: null }, defaultSort: '-updatedAt', sortParams: ['sortBy'], dirParams: ['sortDirection'], unsignedDirection: 'desc', legacySort: { by: 'sortBy', dir: 'sortDirection' }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
