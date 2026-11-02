// superAdminCampaignsApi.ts — Super Admin Campaign Manager client (S10). Reads the cross-tenant Campaign Center state
// (platform KPIs + campaign rows across all tenants/branches) from GET /super-admin/campaigns/state. Super-Admin guard
// is enforced server-side. Optional tenantId scopes the platform view to one tenant.
import { api } from './client';

export const superAdminCampaignsApi = {
  getState: (q?: Record<string, unknown>) => api.get<any>('/super-admin/campaigns/state', q),
};
