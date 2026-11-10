// posAiCenterApi.ts — AI Center overview (real KPIs from ai_usage_logs, appointments, call intelligence,
// campaigns, reminders). Reuses GET /tenant/ai/center/overview. Metrics are honest: tracked or untracked.
import { api } from "./client";
export const posAiCenterApi = {
  overview: (q?: Record<string, unknown>) => api.get<any>(`/tenant/ai/center/overview`, q),   // batch 9 guide 14: ?preset / ?from&to (salon days)
};
