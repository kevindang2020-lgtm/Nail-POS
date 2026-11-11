// owner.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in owner.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const OwnerControllerListQueries = {
  // §66/§67 (M5 pilot): the owner's paycheck week — exceptions only · search a technician · a branch
  paycheckWeek: { filters: { exceptionsOnly: { type: 'text' }, branchId: { type: 'id' } }, search: { params: ['search'] } },
  membershipsOverview: { filters: { branchId: { type: 'id' } }, search: false },
  dashboard: { filters: { branchId: { type: 'id' } }, search: false },
  cashHandoffs: { filters: { date: { type: 'date' } }, search: false },
  cashDrawer: { filters: { date: { type: 'date' } }, search: false },
  cashSummary: { filters: { date: { type: 'date' } }, search: false },
  branchPerformance: { filters: { period: { type: 'text' } }, search: false },
  branchComparison: { filters: { period: { type: 'text' } }, search: false, dateRange: { maxDays: 'analytics' } },
  branchDetail: { filters: { period: { type: 'text' } }, search: false },
  bookingOverview: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  bookingTrend: { filters: { branchId: { type: 'id' } }, search: false },
  bookingDrillDown: { filters: { period: { type: 'text' }, branchId: { type: 'id' }, status: { type: 'text' }, source: { type: 'text' } }, search: false },
  staffPerformance: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  // 200-technician mandate §62/§69/§71: every technician, paged / searched / sorted on the server (the service sorts in memory)
  staffPerformanceTechnicians: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, sorts: { sales: null, services: null, utilization: null, rating: null, commission: null, name: null }, limitParams: ['pageSize'], maxLimit: 100, search: { params: ['search'] }, params: ['page'] },
  staffAttendance: { filters: { branchId: { type: 'id' } }, search: false },
  technicianDetail: { filters: { period: { type: 'text' } }, search: false },
  technicianEarnings: { filters: { period: { type: 'text' } }, search: false },
  financeSummary: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  paymentMix: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  reportExport: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  alerts: { filters: { status: { type: 'text' }, severity: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  alertSummary: { filters: { branchId: { type: 'id' } }, search: false },
  audit: { search: false },
  expenses: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  expenseSummary: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  tickets: { filters: { branchId: { type: 'id' }, status: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] }, params: ['page'] },
  // 200-technician §2: teamPage / teamPageSize / teamSearch / teamStatus page the Team; techQueuePage / techQueuePageSize the in-service list
  live: { filters: { branchId: { type: 'id' }, teamStatus: { type: 'text' } }, search: { params: ['teamSearch'] }, limitParams: ['teamPageSize', 'techQueuePageSize'], maxLimit: 50, params: ['teamPage', 'techQueuePage'] },
  customers: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  giftCardReport: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  inventory: { filters: { branchId: { type: 'id' } }, search: false },
  marketing: { filters: { branchId: { type: 'id' } }, search: false },
  payments: { filters: { period: { type: 'text' }, branchId: { type: 'id' } }, search: false },
  aiCenter: { filters: { branchId: { type: 'id' } }, search: false },
  attention: { filters: { branchId: { type: 'id' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
