// super-admin-revenue-residuals.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-revenue-residuals.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminRevenueResidualsControllerListQueries = {
  overview: { filters: { agreementId: { type: 'id' } }, search: false },
  records: { filters: { agreementId: { type: 'id' }, tenantId: { type: 'id' }, branchId: { type: 'id' }, processor: { type: 'text' }, revenueType: { type: 'text' }, status: { type: 'text' } }, limitParams: ['pageSize'], sorts: { effective_date: 'r.effective_date', gross: 'r.gross_revenue_cents', net: 'r.net_revenue_cents', created: 'r.created_at' }, defaultSort: '-effective_date', sortParams: ['sort'], dirParams: ['direction'], unsignedDirection: 'desc', legacySort: { by: 'sort', dir: 'direction' }, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] }, params: ['page'] },
  agreements: { filters: { tenantId: { type: 'id' }, processor: { type: 'text' }, status: { type: 'text' } } },
  statements: { filters: { processor: { type: 'text' }, tenantId: { type: 'id' }, reviewStatus: { type: 'text' } }, search: false },
  reconciliations: { filters: { statementId: { type: 'id' }, status: { type: 'text' } }, search: false },
  partnerPayouts: { filters: { processor: { type: 'text' }, agreementId: { type: 'id' }, status: { type: 'text' } }, search: false },
  tenantIncentives: { filters: { tenantId: { type: 'id' }, agreementId: { type: 'id' }, status: { type: 'text' } }, search: false },
  export: { filters: { dataset: { type: 'text' }, format: { type: 'text' }, agreementId: { type: 'id' }, tenantId: { type: 'id' }, branchId: { type: 'id' }, processor: { type: 'text' }, revenueType: { type: 'text' }, status: { type: 'text' } }, sorts: { effective_date: 'r.effective_date', gross: 'r.gross_revenue_cents', net: 'r.net_revenue_cents', created: 'r.created_at' }, defaultSort: '-effective_date', sortParams: ['sort'], dirParams: ['direction'], unsignedDirection: 'desc', legacySort: { by: 'sort', dir: 'direction' }, dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] } },
  adjustments: { filters: { revenueRecordId: { type: 'id' }, agreementId: { type: 'id' }, status: { type: 'text' } }, search: false },
  periods: { filters: { status: { type: 'text' } }, search: false },
  unpaidResiduals: { filters: { processor: { type: 'text' }, tenantId: { type: 'id' } }, search: false },
  forecast: { filters: { horizonMonths: { type: 'number' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
