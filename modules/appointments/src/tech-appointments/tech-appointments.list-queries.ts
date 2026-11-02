// tech-appointments.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in tech-appointments.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const TechAppointmentsControllerListQueries = {
  // lanePage / lanePageSize / laneSearch / roster: 200-technician §2 (Oct 26 2026) — the lanes page on the server
  state: { filters: { date: { type: 'date' }, technicianId: { type: 'id' }, status: { type: 'text' }, source: { type: 'text' }, serviceCategory: { type: 'text' }, conflictOnly: { type: 'text' }, depositStatus: { type: 'text' }, branchId: { type: 'id' } }, search: { params: ['search', 'laneSearch'] }, limitParams: ['lanePageSize'], params: ['lanePage', 'roster'] },
  // the lane params are parsed by the shared filtersFrom; the list ignores them (lanes belong to the state)
  list: { filters: { date: { type: 'date' }, technicianId: { type: 'id' }, status: { type: 'text' }, source: { type: 'text' }, serviceCategory: { type: 'text' }, conflictOnly: { type: 'text' }, depositStatus: { type: 'text' }, branchId: { type: 'id' } }, search: { params: ['search', 'laneSearch'] }, limitParams: ['lanePageSize'], params: ['lanePage', 'roster'] },
} satisfies Record<string, ListQuerySpec>;
