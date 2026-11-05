// queue-recommender.nest.ts — resolves the bound QUEUE_RECOMMENDER at call time (BUILD_PLAN Phase 6). The AI module that
// binds it depends on QueueService / TechQueueService, so a constructor injection would be a Nest dependency cycle.
import type { ModuleRef } from '@nestjs/core';
import { QUEUE_RECOMMENDER, type QueueRecommenderPort } from './queue-recommender';

/** The bound QUEUE_RECOMMENDER, or null when no module provides it (the boards then show no suggestion). */
export function lazyRecommender(refs: ModuleRef): QueueRecommenderPort | null {
  try { return refs.get<QueueRecommenderPort>(QUEUE_RECOMMENDER, { strict: false }) ?? null; } catch { return null; }
}
