// ownerAiSchedulingApi.ts — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): the Owner App's branch comparison for the AI
// Scheduling Optimizer (GET /owner/ai-scheduling/summary?days=, perm owner.dashboard.view — agent B's route). Read-only;
// reviewing and applying changes stays on the POS. The shape is the API's own (`SchedOwnerSummary`) — never re-declared.
import { api } from './client';
import type { SchedOwnerSummary, SchedOwnerBranchRow } from '@aipowersalon/api-contracts/tenant';

export type { SchedOwnerSummary, SchedOwnerBranchRow };
export const ownerAiSchedulingApi = {
  summary: (days = 7) => api.get<SchedOwnerSummary>('/owner/ai-scheduling/summary', { days: String(days) }),
};
