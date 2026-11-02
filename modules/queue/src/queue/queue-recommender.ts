// queue-recommender.ts — the ONE seam through which the queue boards get a technician suggestion (BUILD_PLAN Phase 6,
// audit "parallel implementation 1"). The queue used to run three scorers of its own (the board's "Best Match", Auto
// Balance and the Tech Queue's best match) beside the AI engine; only the engine checked breaks, appointments and
// capacity. They are gone. The AI layer (modules/ai, agent B) binds QUEUE_RECOMMENDER; the queue only CALLS it.
// Without a bound recommender the boards show no suggestion — never a second scorer.
import type { QueueContext } from './queue.repository';

export const QUEUE_RECOMMENDER = 'QUEUE_RECOMMENDER';

export interface QueueSuggestion { technicianId: string | null; name: string | null; confidence: number; requiredAction: string; reasons: string[]; mode?: 'single' | 'split'; technicianNames?: string[] }
export interface QueueBalanceProposal { queueItemId: string; technicianId: string; technicianName: string; confidence: number; reasons: string[] }
export interface QueueBalanceResult { proposals: QueueBalanceProposal[]; unassignable: { queueItemId: string; reason: string }[] }

export interface QueueRecommenderPort {
  /** A board preview for these guests. Read-only: it never persists a recommendation and never assigns. */
  suggest(ctx: QueueContext, queueItemIds: string[]): Promise<Record<string, QueueSuggestion>>;
  /** Auto Balance preview: the engine over every unassigned waiting guest; one technician never proposed past capacity. */
  balance(ctx: QueueContext): Promise<QueueBalanceResult>;
  /**
   * Fair Turn Engine (wave 2): the fair pick for this guest and what assigning `assigneeId` instead means — the skips to
   * record and whether a manual-override reason is required (RECOMMEND_AND_CONFIRM / AUTOMATIC + a different technician).
   * Read-only. Absent (an older engine, a legacy rotation) → the queue records the assignment without a recommendation.
   */
  turnDecision?(ctx: QueueContext, queueItemId: string, assigneeId: string): Promise<QueueTurnAdvice | null>;
}
export interface QueueTurnAdvice {
  assignmentMode: 'AUTOMATIC' | 'RECOMMEND_AND_CONFIRM' | 'MANUAL';
  recommendedTechnicianId: string | null;
  skips: { technicianId: string; reason: string }[];
  eligiblePool: string[];
  /** staff chose someone else and the salon's mode asks for a reason (§68) */
  reasonRequired: boolean;
}

/** The recommender is resolved LAZILY: the AI module that binds it depends on QueueService, so a constructor injection
 *  would be a dependency cycle. A plain object (tests) or a resolver (the Nest module, through ModuleRef) both work. */
export type QueueRecommenderSource = QueueRecommenderPort | (() => QueueRecommenderPort | null | undefined) | null | undefined;

export function resolveRecommender(src: QueueRecommenderSource): QueueRecommenderPort | null {
  if (!src) return null;
  if (typeof src === 'function') { try { return src() ?? null; } catch { return null; } }
  return src;
}
