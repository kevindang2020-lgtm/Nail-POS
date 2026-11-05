// customer-tech.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in customer-tech.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const CustomerTechControllerListQueries = {
  nearby: { filters: { lat: { type: 'number' }, lng: { type: 'number' }, radiusMiles: { type: 'number' }, minRating: { type: 'number' } } },
  bookingTechs: { filters: { serviceId: { type: 'id' }, salonId: { type: 'id' } }, search: false },   // salonId: developer merge (Oct 6 2026)
  myRating: { filters: { technicianId: { type: 'id' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
