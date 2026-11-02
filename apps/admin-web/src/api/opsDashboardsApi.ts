// opsDashboardsApi.ts — BUILD_PLAN Phase 14 B (Constitution 11 §145, §149–155, §345): the System Operations dashboards and the
// all-branch health list. Types are the API's own contract (@aipowersalon/api-contracts/platform — Constitution 13 §15).
import type {
  CommunicationsDashboard, DeploymentDashboard, IncidentDashboard, MobileDashboard, PaymentsDashboard, RedisDashboard, StorageDashboard,
  SuperAdminBranchHealthList,
} from '@aipowersalon/api-contracts/platform';
import type { BranchHealthStatus } from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

export const opsDashboardsApi = {
  branchHealth: (q: { sort?: 'worst' | 'name' | 'observed'; status?: BranchHealthStatus; limit?: number; cursor?: string | null } = {}) =>
    api.get<SuperAdminBranchHealthList>('/super-admin/branch-health', Object.fromEntries(Object.entries({ sort: q.sort, status: q.status, limit: q.limit ? String(q.limit) : undefined, cursor: q.cursor ?? undefined }).filter(([, v]) => v !== undefined)) as Record<string, string>),
  storage: () => api.get<StorageDashboard>('/super-admin/system/dashboards/storage'),
  mobile: () => api.get<MobileDashboard>('/super-admin/system/dashboards/mobile'),
  deployments: () => api.get<DeploymentDashboard>('/super-admin/system/dashboards/deployments'),
  redis: () => api.get<RedisDashboard>('/super-admin/system/dashboards/redis'),
  payments: () => api.get<PaymentsDashboard>('/super-admin/system/dashboards/payments'),
  communications: () => api.get<CommunicationsDashboard>('/super-admin/system/dashboards/communications'),
  incidents: () => api.get<IncidentDashboard>('/super-admin/system/dashboards/incidents'),
};
