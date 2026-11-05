// go-check-in.public.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in go-check-in.public.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const GoCheckInPublicControllerListQueries = {
  today: { filters: { customerId: { type: 'id' }, token: { type: 'text', maxLength: 4096 } }, search: false },
  services: { filters: { token: { type: 'text', maxLength: 4096 } }, search: false },
  technicians: { filters: { serviceIds: { type: 'id', multi: true }, token: { type: 'text', maxLength: 4096 } }, search: false },
  status: { filters: { token: { type: 'text', maxLength: 4096 } }, search: false },
  place: { filters: { checkInId: { type: 'id' }, token: { type: 'text', maxLength: 4096 } }, search: false },
} satisfies Record<string, ListQuerySpec>;
