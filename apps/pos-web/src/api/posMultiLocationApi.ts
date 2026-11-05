// posMultiLocationApi.ts — cross-branch comparison for the Reports → Multi-Location screen. Reuses the
// owner branch-comparison endpoint (pos.owner.branches.view; tenant-scoped + branch-access-aware server-side).
import { api } from "./client";
export const posMultiLocationApi = {
  state: (period?: string) => api.get(`/owner/branches/comparison`, period ? { period } : undefined),
};
