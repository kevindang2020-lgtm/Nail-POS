// super-admin-appointment-oversight.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-appointment-oversight.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminAppointmentOversightControllerListQueries = {
  overview: { filters: { tenantId: { type: 'id' } }, search: false },
  search: { filters: { status: { type: 'text' }, source: { type: 'text' }, tenantId: { type: 'id' } }, limitParams: ['pageSize'], params: ['page'] },
  duplicates: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  overlapping: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  changeHistory: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  failures: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  rescheduled: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  missingInfo: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  history: { filters: { appointmentId: { type: 'id' }, tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  dataIntegrity: { filters: { tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  correctionPreview: { filters: { appointmentId: { type: 'id' }, tenantId: { type: 'id' } }, search: false },
} satisfies Record<string, ListQuerySpec>;
