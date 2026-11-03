// posAiInventoryApi.ts — client for the AI Inventory Assistant (/pos/ai-inventory/*). The server derives tenant/branch
// from the session; the client never sends them. All four endpoints here are READ-ONLY analysis (position, low-stock,
// reorder recommendations, slow-moving) — no mutation happens from this workspace.
import { api } from "./client";

export const posAiInventoryApi = {
  // AI Inventory Assistant guides (Nov 3 2026): the Command Center reads the center (cards with definitions and reasons, products, stock
  // activity, the check); the old `context` read is retired (a salon-wide login read 0 stock everywhere)
  center: {
    summary: () => api.get<any>(`/pos/ai-inventory/center/summary`),
    products: (q: Record<string, string | number | undefined> = {}) => api.get<any>(`/pos/ai-inventory/center/products`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>),
    activity: (q: Record<string, string | number | undefined> = {}) => api.get<any>(`/pos/ai-inventory/center/activity`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>),
    check: () => api.post<any>(`/pos/ai-inventory/center/check`, {}),
  },
  lowStock: () => api.get<any>(`/pos/ai-inventory/low-stock`),
  reorder: () => api.get<any>(`/pos/ai-inventory/reorder-recommendations`),
  slowMoving: (includeNew = false) => api.get<any>(`/pos/ai-inventory/slow-moving`, includeNew ? { includeNew: 'true' } : undefined),
};
