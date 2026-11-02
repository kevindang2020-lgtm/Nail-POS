// superAdminAiCustomerProfileApi.ts — typed client for Super Admin AI Customer Profile oversight
// (GET /super-admin/ai-customer-profile/overview + /tenants/:tenantId). Platform counts + audited support-mode
// drill-down. No cross-tenant customer data crosses this client.
import { api } from './client';

const enc = encodeURIComponent;

export const superAdminAiCustomerProfileApi = {
  overview: () => api.get<any>('/super-admin/ai-customer-profile/overview'),
  tenantView: (tenantId: string, reason: string) =>
    api.get<any>(`/super-admin/ai-customer-profile/tenants/${enc(tenantId)}`, reason ? { reason } : undefined),
};
