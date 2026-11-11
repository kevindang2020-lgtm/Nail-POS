// posMarketingReportApi.ts — composed marketing performance (campaigns + promotions + reviews).
// pos.marketing.view. Reuses the marketing-report backend which composes the three domain services.
import { api } from "./client";
export const posMarketingReportApi = {
  // batch 9 decision 2: an optional period — { preset } or { preset: 'custom', from, to }; none / 'all' = all time
  state: (q?: Record<string, string | undefined>) => api.get(`/pos/marketing-report/state`, q && q.preset && q.preset !== 'all' ? q : undefined),
};
