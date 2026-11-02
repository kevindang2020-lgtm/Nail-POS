// live-technician-schedule.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in live-technician-schedule.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const LiveTechnicianScheduleControllerListQueries = {
  // lanePage / lanePageSize / laneSearch / roster: 200-technician §2 (Oct 27 2026) — the technician columns page on the server
  state: { filters: { date: { type: 'date' }, view: { type: 'text' }, status: { type: 'text' }, skill: { type: 'text' } }, search: { params: ['search', 'laneSearch'] }, limitParams: ['lanePageSize'], params: ['lanePage', 'roster'] },
  kpis: { filters: { date: { type: 'date' } }, search: false },
  week: { filters: { date: { type: 'date' }, view: { type: 'text' }, status: { type: 'text' }, skill: { type: 'text' } }, search: { params: ['search', 'laneSearch'] }, limitParams: ['lanePageSize'], params: ['lanePage', 'roster'] },
  board: { filters: { date: { type: 'date' }, view: { type: 'text' }, status: { type: 'text' }, skill: { type: 'text' } }, search: { params: ['search', 'laneSearch'] }, limitParams: ['lanePageSize'], params: ['lanePage', 'roster'] },
  detail: { filters: { date: { type: 'date' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
