// customer-phone-settings.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in customer-phone-settings.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const CustomerPhoneSettingsControllerListQueries = {
  get: { filters: { branchId: { type: 'id' } }, search: false },
} satisfies Record<string, ListQuerySpec>;

export const CustomerPhoneOversightControllerListQueries = {
  oversight: { filters: { hours: { type: 'number' }, tenantId: { type: 'id' } }, search: false },
  oversightByTenant: { filters: { hours: { type: 'number' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
