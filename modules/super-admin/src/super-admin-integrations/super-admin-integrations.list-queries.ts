// super-admin-integrations.list-queries.ts — BUILD_PLAN Phase 12 (Constitution 5 §47–§52, DoD #21/#22/#23): the declared filters, sorts,
// search and date-range cap of each list endpoint in super-admin-integrations.controller.ts (@ListQueries on the controller). The legacy
// parameter names are the handlers' own and keep working; filter[x], q, sort, limit and from/to are the canonical forms
// (packages/api-contracts/src/list-query.ts). Unknown filter[x] / sort → 400; a range over maxDays → 400.
import type { ListQuerySpec } from '@aipowersalon/database';

export const SuperAdminIntegrationsControllerListQueries = {
  overview: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
  connected: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
  webhookEvents: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
  alerts: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
  errors: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
  tenantUsage: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
  export: { filters: { integrationType: { type: 'text' }, tenantId: { type: 'id' }, status: { type: 'text' }, authStatus: { type: 'text' }, syncState: { type: 'text' }, format: { type: 'text' } }, dateRange: { maxDays: 'analytics', from: ['dateFrom'], to: ['dateTo'] } },
} satisfies Record<string, ListQuerySpec>;
