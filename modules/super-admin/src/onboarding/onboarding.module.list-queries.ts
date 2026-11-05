// onboarding.module.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in onboarding.module.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';


// The onboarding records list — validated at the edge by the interceptor AND applied by the repository
// (onboarding.kysely.repository.ts applyListQuery): one declaration for the allow-list, the columns and the sort.
export const ONBOARDING_RECORDS_SPEC = {
  filters: {
    applicationType: { type: 'text', column: 'r.application_type' },
    stage: { type: 'text', column: 'r.current_stage' },
    specialistId: { type: 'id', column: 'r.specialist_user_id' },
    merchantStatus: { type: 'text', column: 'r.merchant_status' },
    hardwareStatus: { type: 'text', column: 'r.hardware_status' },
    importStatus: { type: 'text', column: 'r.data_import_status' },
    trainingStatus: { type: 'text', column: 'r.training_status' },
    hasMissingDocuments: { type: 'text' },   // a count comparison (> 0 / = 0) — applied by the repository itself
  },
  search: { params: ['search'], columns: ['ta.salon_name', 'ta.owner_name', 'ta.email'] },
  sorts: {
    tenant: 'ta.salon_name', branches: 'r.branch_count', stage: 'r.current_stage', completion: 'r.completion_pct',
    specialist: 'u.full_name', missingDocs: 'r.missing_docs_count', merchant: 'r.merchant_status',
    hardware: 'r.hardware_status', dataImport: 'r.data_import_status', training: 'r.training_status',
    updated: 'r.updated_at', created: 'r.created_at', stageAge: 'r.stage_entered_at',
  },
  defaultSort: '-updated', tiebreaker: 'r.id',
  sortParams: ['sort'], dirParams: ['direction'], unsignedDirection: 'desc', legacySort: { by: 'sort', dir: 'direction' },
  limitParams: ['pageSize'], maxLimit: 100, defaultLimit: 10, params: ['page'],
} satisfies ListQuerySpec;

export const OnboardingControllerListQueries = {
  overview: ONBOARDING_RECORDS_SPEC,
  list: ONBOARDING_RECORDS_SPEC,
  approvals: { filters: { status: { type: 'text' }, approvalType: { type: 'text' } }, search: false },
  export: { ...ONBOARDING_RECORDS_SPEC, filters: { ...ONBOARDING_RECORDS_SPEC.filters, format: { type: 'enum', values: ['csv', 'excel', 'pdf'] } } },
} satisfies Record<string, ListQuerySpec>;
