// booking.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in booking.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const BookingControllerListQueries = {
  state: { filters: { date: { type: 'date' }, technicianId: { type: 'id' }, status: { type: 'text' }, source: { type: 'text' }, serviceCategory: { type: 'text' }, conflictOnly: { type: 'text' }, depositStatus: { type: 'text' }, branchId: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'] }, dateRange: { maxDays: 'analytics' }, params: ['page', 'roster'] },
  list: { filters: { date: { type: 'date' }, technicianId: { type: 'id' }, status: { type: 'text' }, source: { type: 'text' }, serviceCategory: { type: 'text' }, conflictOnly: { type: 'text' }, depositStatus: { type: 'text' }, branchId: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'] }, dateRange: { maxDays: 'analytics' }, params: ['page', 'roster'] },
  availability: { filters: { date: { type: 'date' }, serviceIds: { type: 'id', multi: true }, technicianId: { type: 'id' }, branchId: { type: 'id' }, technicianIds: { type: 'id', multi: true } }, search: false },
  // 200-technician mandate (Oct 23 2026): the board's technician columns (12 a page, server-side) and server-side openings
  technicianPage: { filters: { date: { type: 'date' }, serviceIds: { type: 'id', multi: true }, working: { type: 'text' }, status: { type: 'text' }, skill: { type: 'text' }, locate: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'], maxLength: 80 }, params: ['page'] },
  openings: { filters: { date: { type: 'date' }, serviceIds: { type: 'id', multi: true } }, limitParams: ['limit'], search: false, params: ['offset'] },
  changes: { filters: { since: { type: 'date' } }, search: false },
  dayGrid: { filters: { date: { type: 'date' }, technicianIds: { type: 'id', multi: true }, status: { type: 'text' }, source: { type: 'text' }, serviceCategory: { type: 'text' }, conflictOnly: { type: 'text' }, depositStatus: { type: 'text' } }, search: { params: ['search'] } },
} satisfies Record<string, ListQuerySpec>;
