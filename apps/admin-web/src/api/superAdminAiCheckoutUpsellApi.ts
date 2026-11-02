// superAdminAiCheckoutUpsellApi.ts — Super Admin oversight client. Platform counts + audited per-tenant support drill-down.
import { api } from './client';

export const superAdminAiCheckoutUpsellApi = {
  overview: () => api.get<any>('/super-admin/ai-checkout-upsell/overview'),
  tenantView: (tenantId: string, reason: string) => api.get<any>(`/super-admin/ai-checkout-upsell/tenants/${encodeURIComponent(tenantId)}`, { reason }),
};
