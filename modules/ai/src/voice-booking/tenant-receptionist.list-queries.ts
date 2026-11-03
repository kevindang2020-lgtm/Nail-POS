// tenant-receptionist.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in tenant-receptionist.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const TenantReceptionistControllerListQueries = {
  calls: { search: false },
  settingsHistory: { search: false, maxLimit: 50, params: ['page'] },
  // listFollowUps retired with tenant/ai/receptionist/follow-ups* (AI Follow-Ups guide 26) — its spec must go too: @ListQueries
  // refuses a name that is not a method, and that refusal stopped the API from booting.
} satisfies Record<string, ListQuerySpec>;
