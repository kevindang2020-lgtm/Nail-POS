// posAiCenterApi.ts — AI Center overview (real KPIs from ai_usage_logs, appointments, call intelligence,
// campaigns, reminders). Reuses GET /tenant/ai/center/overview. Metrics are honest: tracked or untracked.
import { api } from "./client";
export const posAiCenterApi = {
  overview: () => api.get<any>(`/tenant/ai/center/overview`),
};
