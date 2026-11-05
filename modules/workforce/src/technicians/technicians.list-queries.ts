// technicians.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in technicians.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const TechniciansControllerListQueries = {
  state: { filters: { status: { type: 'text' }, workingStatus: { type: 'text' }, skillGroup: { type: 'text' }, serviceCategory: { type: 'text' }, techAppEnabled: { type: 'text' }, canProcessPayment: { type: 'text' }, missingSchedule: { type: 'text' }, missingMapping: { type: 'text' }, shiftStatus: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  search: { filters: { status: { type: 'text' }, workingStatus: { type: 'text' }, skillGroup: { type: 'text' }, serviceCategory: { type: 'text' }, techAppEnabled: { type: 'text' }, canProcessPayment: { type: 'text' }, missingSchedule: { type: 'text' }, missingMapping: { type: 'text' }, shiftStatus: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  qualified: { filters: { serviceId: { type: 'id' } }, search: false },
  export: { filters: { status: { type: 'text' }, workingStatus: { type: 'text' }, skillGroup: { type: 'text' }, serviceCategory: { type: 'text' }, techAppEnabled: { type: 'text' }, canProcessPayment: { type: 'text' }, missingSchedule: { type: 'text' }, missingMapping: { type: 'text' }, shiftStatus: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  list: { filters: { status: { type: 'text' }, workingStatus: { type: 'text' }, skillGroup: { type: 'text' }, serviceCategory: { type: 'text' }, techAppEnabled: { type: 'text' }, canProcessPayment: { type: 'text' }, missingSchedule: { type: 'text' }, missingMapping: { type: 'text' }, shiftStatus: { type: 'text' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
} satisfies Record<string, ListQuerySpec>;
