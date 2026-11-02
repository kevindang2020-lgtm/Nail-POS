// ownerAiQueueApi.ts — BUILD_PLAN Phase 6 (ai_queue_assignment): the Owner App's branch comparison for AI queue
// assignment (GET owner/ai-queue-assignment/summary?days=, perm owner.dashboard.view — agent C's route). The audit's
// UI row "Owner: no AI-specific additions" and the spec's "branch comparison". Read-only; managing the AI stays on the POS.
import { api } from './client';

// Mirrors agent C's response (modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.service.ts ownerSummary) — not
// in @aipowersalon/api-contracts yet; the lead may move it there.
export interface OwnerAiQueueBranchRow {
  branchId: string;
  name: string;
  /** guests served in the period (the wait figures are over these) */
  served: number;
  avgWaitMinutes: number | null;
  longestWaitMinutes: number | null;
  /** accepted ÷ staff decisions, a 0–1 share rounded to 3 places (auto-assignments are NOT staff decisions — bug 13); null = none */
  acceptanceRate: number | null;
  staffDecisions: number;
  autoAssigned: number;
  openAlerts: number;
}
export interface OwnerAiQueueSummary {
  /** the server clamps ?days= to 1–90 */
  days: number;
  range: { from: string; to: string };
  branches: OwnerAiQueueBranchRow[];
  /** the same figures over every location (branchId / name are null) */
  totals: Omit<OwnerAiQueueBranchRow, 'branchId' | 'name'> & { branchId: null; name: null };
}
export const ownerAiQueueApi = {
  summary: (days = 30) => api.get<OwnerAiQueueSummary>('/owner/ai-queue-assignment/summary', { days: String(days) }),
};
