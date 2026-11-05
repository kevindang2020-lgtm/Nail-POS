// ai-queue-assignment-recommender.ts — BUILD_PLAN Phase 6 (audit "parallel implementations" 1): the queue boards' "Best
// Match", Auto Balance preview and Tech Queue best match come from the AI engine through the QUEUE_RECOMMENDER seam the
// queue domain declares (`@aipowersalon/queue`). The queue's own three scorers are removed; without this binding the
// boards show no suggestion (never a second scorer).
//
// Bound GLOBALLY so QueueModule's QueueService / TechQueueService can inject it (@Optional). It depends only on
// ModuleRef and resolves QueueAssignmentService on first use — QueueAssignmentService itself depends on QueueService,
// so a constructor dependency would be a provider cycle.
import { Global, Module } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { QUEUE_RECOMMENDER_TOKEN } from './ai-queue-assignment.tokens';
import { QueueAssignmentService, type SuggestResult, type BalanceResult } from './ai-queue-assignment.service';
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';

/** Structurally the queue's `QueueRecommenderPort` (contract: suggest without persisting; balance with capacity). */
export interface QueueRecommender {
  suggest(ctx: QueueAssignmentContext, queueItemIds: string[]): Promise<Record<string, SuggestResult>>;
  balance(ctx: QueueAssignmentContext): Promise<BalanceResult>;
  /** Fair Turn Engine: the fair pick + skips for an assignment staff are about to make (null = no advice) */
  turnDecision?(ctx: QueueAssignmentContext, queueItemId: string, assigneeId: string): Promise<Awaited<ReturnType<QueueAssignmentService['turnDecision']>>>;
}

export class EngineQueueRecommender implements QueueRecommender {
  constructor(private readonly service: () => QueueAssignmentService | null) {}
  async suggest(ctx: QueueAssignmentContext, queueItemIds: string[]) {
    const s = this.service(); if (!s) return {};
    try { return await s.suggest(toCtx(ctx), queueItemIds); } catch { return {}; }   // a board never fails on a suggestion
  }
  async balance(ctx: QueueAssignmentContext) {
    const s = this.service(); if (!s) return { proposals: [], unassignable: [] };
    try { return await s.balance(toCtx(ctx)); } catch { return { proposals: [], unassignable: [] }; }
  }
  async turnDecision(ctx: QueueAssignmentContext, queueItemId: string, assigneeId: string) {
    const s = this.service(); if (!s) return null;
    try { return await s.turnDecision(toCtx(ctx), queueItemId, assigneeId); } catch { return null; }   // advice only — never blocks an assignment
  }
}
function toCtx(c: any): QueueAssignmentContext {
  return { tenantId: c?.tenantId, branchId: typeof c?.branchId === 'string' ? c.branchId : '', userId: c?.userId, role: c?.role, permissions: c?.permissions || [] };
}

@Global()
@Module({
  providers: [{
    provide: QUEUE_RECOMMENDER_TOKEN,
    useFactory: (ref: ModuleRef): QueueRecommender => {
      let cached: QueueAssignmentService | null = null;
      return new EngineQueueRecommender(() => {
        if (cached) return cached;
        // Resolved at call time (strict: false — it lives in QueueAssignmentCoreModule).
        try { cached = ref.get(QueueAssignmentService, { strict: false }); } catch { cached = null; }
        return cached;
      });
    },
    inject: [ModuleRef],
  }],
  exports: [QUEUE_RECOMMENDER_TOKEN],
})
export class QueueRecommenderModule {}
