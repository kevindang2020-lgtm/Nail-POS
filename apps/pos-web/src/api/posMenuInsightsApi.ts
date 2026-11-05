import { api } from './client';

// posMenuInsightsApi — AI Pricing & Menu Insights (`/pos/menu-insights`). Returns computed insights + an honest
// hasEnoughData flag and coverage; when there's no history the UI shows the empty state rather than invented rows.
export const posMenuInsightsApi = {
  get: (windowDays = 30) => api.get(`/pos/menu-insights?windowDays=${encodeURIComponent(String(windowDays))}`),
};
