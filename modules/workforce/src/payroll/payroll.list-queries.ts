// payroll.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in payroll.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

// The payroll periods list — validated by the interceptor AND applied by the repository (payroll.kysely.repository.ts).
export const PAYROLL_PERIODS_SPEC = {
  filters: { status: { type: 'text', column: 'status' } },
  search: { params: ['search'], columns: ['label'] },
  sorts: { periodStart: 'period_start' }, defaultSort: '-periodStart', tiebreaker: 'id',
  limitParams: ['pageSize'], maxLimit: 200, defaultLimit: 50, params: ['page'],
} satisfies ListQuerySpec;

// Payroll wave 2 (Oct 12 2026): the queues are bounded server-side (the services cap them at 100–500 rows, newest first);
// these declare the filters each one reads so an unknown filter is a 400, not silently ignored.
export const PAYROLL_ADJUSTMENTS_SPEC = { filters: { status: { type: 'text' }, periodId: { type: 'id' } }, sorts: { createdAt: null }, defaultSort: '-createdAt', maxLimit: 200, defaultLimit: 200 } satisfies ListQuerySpec;
export const PAYROLL_EXCEPTIONS_SPEC = { filters: { status: { type: 'text' }, kind: { type: 'text' } }, sorts: { createdAt: null }, defaultSort: '-createdAt', maxLimit: 200, defaultLimit: 100 } satisfies ListQuerySpec;
export const PAYROLL_INQUIRIES_SPEC = { filters: { status: { type: 'text' } }, sorts: { createdAt: null }, defaultSort: '-createdAt', maxLimit: 200, defaultLimit: 200 } satisfies ListQuerySpec;
export const PAYROLL_PAY_PLANS_SPEC = { filters: { technicianId: { type: 'id' } }, sorts: { effectiveStart: null }, defaultSort: '-effectiveStart', maxLimit: 500, defaultLimit: 500 } satisfies ListQuerySpec;

export const PayrollControllerListQueries = {
  state: PAYROLL_PERIODS_SPEC,
  adjustments: PAYROLL_ADJUSTMENTS_SPEC,
  exceptions: PAYROLL_EXCEPTIONS_SPEC,
  inquiries: PAYROLL_INQUIRIES_SPEC,
  listPayPlans: PAYROLL_PAY_PLANS_SPEC,
} satisfies Record<string, ListQuerySpec>;

export const SuperAdminPayrollControllerListQueries = {
  state: { ...PAYROLL_PERIODS_SPEC, filters: { ...PAYROLL_PERIODS_SPEC.filters, tenantId: { type: 'id' } } },
} satisfies Record<string, ListQuerySpec>;
