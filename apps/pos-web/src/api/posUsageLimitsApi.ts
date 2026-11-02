// posUsageLimitsApi.ts — the tenant's own plan limits + current usage (settings.view). Server-derived tenant.
import { api } from "./client";
export const posUsageLimitsApi = {
  state: () => api.get<any>(`/tenant/account/usage-limits/state`),
};
