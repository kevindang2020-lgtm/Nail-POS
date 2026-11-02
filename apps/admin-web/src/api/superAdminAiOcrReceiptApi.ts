// superAdminAiOcrReceiptApi.ts — Super Admin oversight client. Platform operational counts + an audited, reason-required
// per-tenant support drill-down. No endpoint returns tenant document content (the backend guarantees this).
import { api } from './client';

export const superAdminAiOcrReceiptApi = {
  overview: () => api.get<any>('/super-admin/ai-ocr-receipt/overview'),
  tenantView: (tenantId: string, reason: string) => api.get<any>(`/super-admin/ai-ocr-receipt/tenants/${encodeURIComponent(tenantId)}`, { reason }),
};
