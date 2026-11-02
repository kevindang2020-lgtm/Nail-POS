// super-admin-customer-data.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-customer-data.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminCustomerDataControllerListQueries = {
  syncRuns: { search: false },
  syncConflicts: { filters: { status: { type: 'text' } }, search: false },
  syncMergePreview: { filters: { a: { type: 'text' }, b: { type: 'text' } }, search: false },
  overview: { filters: { tenantId: { type: 'id' }, branchId: { type: 'id' }, status: { type: 'text' }, phoneStatus: { type: 'text' }, emailStatus: { type: 'text' }, consentStatus: { type: 'text' }, duplicateRisk: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, sorts: { name: null, tenant: null, completeness: null, duplicateRisk: null, consent: null, updated: null }, sortParams: ['sort'], dirParams: ['direction'], unsignedDirection: 'desc', legacySort: { by: 'sort', dir: 'direction' }, params: ['page'] },
  listMerges: { filters: { tenantId: { type: 'id' } }, search: false },
  listActivity: { filters: { tenantId: { type: 'id' } }, search: false },
  listHolds: { filters: { tenantId: { type: 'id' }, status: { type: 'text' } }, search: false },
  listImports: { filters: { tenantId: { type: 'id' }, status: { type: 'text' } }, search: false },
  listDeletions: { filters: { tenantId: { type: 'id' }, status: { type: 'text' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
