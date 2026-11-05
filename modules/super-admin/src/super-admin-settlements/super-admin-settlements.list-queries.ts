// super-admin-settlements.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-settlements.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

const SETTLEMENTS_SPEC = {
  filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, processor: { type: 'text' }, settlementStatus: { type: 'text' }, reconciliationStatus: { type: 'text' }, fundingLast4: { type: 'text', maxLength: 4 }, selectedId: { type: 'id' } },
  search: { params: ['search'] },
  sorts: { batchRef: 's.settlement_id', tenant: 't.display_name', branch: 'b.name', processor: 's.processor_type', gross: 's.gross_cents', net: 's.net_cents', expected: 's.expected_deposit_date', actual: 's.actual_deposit_date', status: 's.status', difference: 's.signed_difference_cents', created: 's.created_at' },
  defaultSort: '-created', sortParams: ['sort'], dirParams: ['direction'], unsignedDirection: 'desc', legacySort: { by: 'sort', dir: 'direction' },
  limitParams: ['pageSize'], params: ['page'],
  dateRange: { maxDays: 'analytics', from: ['startDate'], to: ['endDate'] },
} satisfies ListQuerySpec;

export const SuperAdminSettlementsControllerListQueries = {
  overview: SETTLEMENTS_SPEC,
  export: SETTLEMENTS_SPEC,
  exportXlsx: SETTLEMENTS_SPEC,
  exportPdf: SETTLEMENTS_SPEC,
} satisfies Record<string, ListQuerySpec>;
