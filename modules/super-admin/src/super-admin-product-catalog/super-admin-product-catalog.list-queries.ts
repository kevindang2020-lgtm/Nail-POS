// super-admin-product-catalog.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-product-catalog.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminProductCatalogControllerListQueries = {
  overview: { filters: { tenantId: { type: 'id' }, categoryId: { type: 'id' }, brandId: { type: 'id' }, vendorId: { type: 'id' }, status: { type: 'text' }, duplicateOnly: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, sorts: { name: null, brand: null, sku: null, category: null, cost: null, retail: null, tenants: null }, sortParams: ['sort'], dirParams: ['direction'], legacySort: { by: 'sort', dir: 'direction' }, params: ['page'] },
  listImports: { filters: { status: { type: 'text' }, cap: { type: 'number' } }, search: false },
  listImportErrors: { filters: { jobId: { type: 'id' }, status: { type: 'text' }, cap: { type: 'number' } }, search: false },
  listDistributions: { filters: { masterProductId: { type: 'id' }, tenantId: { type: 'id' }, cap: { type: 'number' } }, search: false },
  listMasters: { filters: { status: { type: 'text' }, cap: { type: 'number' } }, search: { params: ['search'] } },
} satisfies Record<string, ListQuerySpec>;
