// posInventoryReportApi.ts — inventory analytics for Reports → Inventory. Reuses the tenant inventory endpoints
// (inventory.view; tenant/branch scoped server-side). Batch 9 guide 11 (Nov 10 2026): the report reads the Inventory screen's
// metrics (one definition per card, expired bottles counted apart), its product list (needs_reorder, searched, paged) and its
// stock-movement ledger (newest first, by period) — no second inventory engine.
import { api } from "./client";
export const posInventoryReportApi = {
  summary: () => api.get(`/tenant/inventory/summary`),
  alerts: () => api.get(`/tenant/inventory/alerts`),
  metrics: () => api.get(`/tenant/inventory/screen/metrics`),
  products: (q: Record<string, unknown>) => api.get(`/tenant/inventory/screen/products`, q),
  movements: (q: Record<string, unknown>) => api.get(`/tenant/inventory/screen/movements`, q),
};
