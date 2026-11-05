// posMarketingReportApi.ts — composed marketing performance (campaigns + promotions + reviews).
// pos.marketing.view. Reuses the marketing-report backend which composes the three domain services.
import { api } from "./client";
export const posMarketingReportApi = {
  state: () => api.get(`/pos/marketing-report/state`),
};
