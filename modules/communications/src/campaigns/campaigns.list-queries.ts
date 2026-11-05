// campaigns.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in campaigns.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

// The campaigns list — validated by the interceptor AND applied by the repository (campaigns.kysely.repository.ts).
export const CAMPAIGNS_SPEC = {
  filters: { status: { type: 'text', column: 'status' }, channel: { type: 'text', column: 'channel' } },
  search: { params: ['search'], columns: ['name', 'offer', 'audience_label'] },
  sorts: { createdAt: 'created_at' }, defaultSort: '-createdAt', tiebreaker: 'id',
  limitParams: ['pageSize'], maxLimit: 200, defaultLimit: 50, params: ['page'],
} satisfies ListQuerySpec;
const CAMPAIGNS_PLATFORM_SPEC = { ...CAMPAIGNS_SPEC, filters: { ...CAMPAIGNS_SPEC.filters, tenantId: { type: 'id' } } } satisfies ListQuerySpec;

export const CampaignsControllerListQueries = {
  state: CAMPAIGNS_SPEC,
  list: CAMPAIGNS_SPEC,
} satisfies Record<string, ListQuerySpec>;

export const SuperAdminCampaignsControllerListQueries = {
  state: CAMPAIGNS_PLATFORM_SPEC,
  marketingOverview: { filters: { tenantId: { type: 'id' }, channel: { type: 'text' }, status: { type: 'text' }, ownerType: { type: 'text' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  promotions: { filters: { status: { type: 'text' }, tenantId: { type: 'id' } }, limitParams: ['pageSize'], search: { params: ['search'] }, params: ['page'] },
  listAnnouncements: { filters: { status: { type: 'text' } }, search: false },
  complianceFlags: { filters: { status: { type: 'text' } }, search: false },
  deliveryFailures: { filters: { category: { type: 'text' } }, search: false },
  performanceTrend: { search: false, dateRange: { maxDays: 'analytics', days: ['days'] } },
  listTemplates: { filters: { status: { type: 'text' } }, search: false },
  list: CAMPAIGNS_PLATFORM_SPEC,
} satisfies Record<string, ListQuerySpec>;
