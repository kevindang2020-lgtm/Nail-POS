// posInventoryReportApi.ts — inventory analytics for Reports → Inventory. Reuses the tenant inventory
// summary + alerts endpoints (inventory.view; tenant/branch scoped server-side).
import { api } from "./client";
export const posInventoryReportApi = {
  summary: () => api.get(`/tenant/inventory/summary`),
  alerts: () => api.get(`/tenant/inventory/alerts`),
};
