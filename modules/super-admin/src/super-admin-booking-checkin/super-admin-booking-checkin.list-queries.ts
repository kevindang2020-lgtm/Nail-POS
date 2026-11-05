// super-admin-booking-checkin.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-booking-checkin.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminBookingCheckinControllerListQueries = {
  overview: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, source: { type: 'text' }, status: { type: 'text' } }, search: false, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] } },
  failedEvents: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, category: { type: 'text' }, retryStatus: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] }, params: ['page'] },
  devices: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, status: { type: 'text' }, deviceType: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  aiHandoffs: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, status: { type: 'text' }, transferredTo: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] }, params: ['page'] },
  bookingSources: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] } },
  checkinPerformance: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] } },
  waitTimeAnalysis: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] } },
  export: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, type: { type: 'text' }, format: { type: 'text' }, source: { type: 'text' }, status: { type: 'text' }, category: { type: 'text' }, retryStatus: { type: 'text' } }, search: { params: ['search'] }, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] } },
} satisfies Record<string, ListQuerySpec>;
