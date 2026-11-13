// compensation.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in compensation.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const CompensationControllerListQueries = {
  agreementsList: { filters: { technicianId: { type: 'id' } }, search: false },
  reportCommission: { filters: { branchId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics' } },
  reportSupply: { filters: { branchId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics' } },
  servicePreviewGet: { filters: { serviceId: { type: 'id' }, priceCents: { type: 'text', maxLength: 10 } }, search: false },
  dealReviewsList: { filters: { flagged: { type: 'enum', values: ['true', 'false'] } }, search: false, params: ['page', 'pageSize'] },   // Deals & Offers 12
  reportTips: { filters: { branchId: { type: 'id' } }, search: false, dateRange: { maxDays: 'analytics' } },
} satisfies Record<string, ListQuerySpec>;
