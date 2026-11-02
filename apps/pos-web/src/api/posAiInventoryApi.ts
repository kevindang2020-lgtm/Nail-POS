// posAiInventoryApi.ts — client for the AI Inventory Assistant (/pos/ai-inventory/*). The server derives tenant/branch
// from the session; the client never sends them. All four endpoints here are READ-ONLY analysis (position, low-stock,
// reorder recommendations, slow-moving) — no mutation happens from this workspace.
import { api } from "./client";

export const posAiInventoryApi = {
  context: () => api.get<any>(`/pos/ai-inventory/context`),
  lowStock: () => api.get<any>(`/pos/ai-inventory/low-stock`),
  reorder: () => api.get<any>(`/pos/ai-inventory/reorder-recommendations`),
  slowMoving: (includeNew = false) => api.get<any>(`/pos/ai-inventory/slow-moving`, includeNew ? { includeNew: 'true' } : undefined),
};
