// community-moderation.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in community-moderation.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const CommunityModerationControllerListQueries = {
  posts: { filters: { queue: { type: 'text' }, category: { type: 'text' }, severity: { type: 'text' } }, limitParams: ['pageSize'], params: ['page'] },
  cases: { filters: { mine: { type: 'text' }, status: { type: 'text' }, kind: { type: 'text' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  reports: { filters: { kind: { type: 'text' }, status: { type: 'text' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  disputes: { filters: { status: { type: 'text' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  appeals: { filters: { status: { type: 'text' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  evidence: { filters: { status: { type: 'text' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  evidenceAccess: { filters: { caseId: { type: 'id' }, reason: { type: 'text' } }, search: false },
  tenants: { limitParams: ['pageSize'], params: ['page'] },
  restrictions: { filters: { active: { type: 'text' } }, search: false },
  actions: { filters: { caseId: { type: 'id' }, postId: { type: 'id' } }, limitParams: ['pageSize'], search: false, params: ['page'] },
  analytics: { search: false, dateRange: { maxDays: 'analytics' } },
} satisfies Record<string, ListQuerySpec>;
