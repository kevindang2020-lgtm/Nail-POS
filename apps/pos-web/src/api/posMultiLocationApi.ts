// posMultiLocationApi.ts — cross-branch comparison for the Reports → Multi-Location screen. Reuses the
// owner branch-comparison endpoint (pos.owner.branches.view; tenant-scoped + branch-access-aware server-side).
import { api } from "./client";
export const posMultiLocationApi = {
  // Nov 10 2026: an optional custom From–To (salon days) beside the presets
  state: (period?: string, range?: { from: string; to: string }) => api.get(`/owner/branches/comparison`, range ? { period: period || 'month', from: range.from, to: range.to } : period ? { period } : undefined),
};
