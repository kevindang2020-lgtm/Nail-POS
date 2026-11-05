// posInventoryAlertsApi.ts — persisted, acknowledgeable stock-threshold alert feed (inventory.view).
// Distinct from the live computed /inventory/alerts used by the Inventory report.
import { api } from "./client";
export const posInventoryAlertsApi = {
  list: (includeAcknowledged: boolean) => api.get<any>(`/tenant/inventory/alert-feed`, { includeAcknowledged: includeAcknowledged ? 'true' : 'false' }),
  acknowledge: (id: string) => api.post(`/tenant/inventory/alert-feed/${encodeURIComponent(id)}/acknowledge`),
};
