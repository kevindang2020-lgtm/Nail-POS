// posAiUsageApi.ts — AI packages: the tenant's AI subscriptions + real usage (from ai_usage_logs).
// Reuses the tenant/ai backend. Read + subscription actions (start trial / cancel) require ai.manage.
import { api } from "./client";
const enc = encodeURIComponent;
export const posAiUsageApi = {
  packages: () => api.get<any>(`/tenant/ai/packages`),
  startTrial: (packageCode: string) => api.post(`/tenant/ai/subscriptions`, { packageCode }),
  cancel: (code: string) => api.patch(`/tenant/ai/subscriptions/${enc(code)}/cancel`),
};
