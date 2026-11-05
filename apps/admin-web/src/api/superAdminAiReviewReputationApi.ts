// superAdminAiReviewReputationApi.ts — Super Admin oversight client. Platform operational counts + an audited,
// reason-required per-tenant support drill-down. No endpoint returns tenant review content (the backend guarantees this).
import { api } from './client';

export const superAdminAiReviewReputationApi = {
  overview: () => api.get<any>('/super-admin/ai-review-reputation/overview'),
  tenantView: (tenantId: string, reason: string) => api.get<any>(`/super-admin/ai-review-reputation/tenants/${encodeURIComponent(tenantId)}`, { reason }),
};
