// ai-queue-assignment-explanation.service.ts -- turns a stored recommendation into a short natural-language rationale.
// On ANY failure (platform error, unentitled, disabled, empty) it falls back to the deterministic explanation so
// staff always get a usable answer. Output is always sanitized. Never sends customer PII.
//
// Constitution 10 Phase 23: this service held an AiGatewayService and did its OWN entitlement check and its OWN
// usage logging -- one of four modules each implementing the same concerns differently. Both now live in
// AiPlatform.execute('queue.explain_recommendation'), so the per-module usage logger and its AiUsageLogger
// dependency are gone. The module-level entitlement port is KEPT: it is a tenant FEATURE toggle
// (QueueAssignmentDisabledError), which is a different question from package entitlement and is checked first.
//
// The task key changed during this migration. The registry first declared `queue.recommend_assignment`, assuming
// the model ranked technicians. It never did -- ai-queue-assignment-engine ranks via scoreTechnician() and the
// model only ever explained the result. The registry was corrected to match the code.
import { hasPermission } from '@aipowersalon/permissions';

import type { QueueAssignmentRepositoryPort } from './ai-queue-assignment.repository';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import { deterministicExplanation, explanationPromptData, sanitize } from './ai-queue-assignment-explanation';
import { QueueAssignmentContext, QueueAssignmentForbiddenError, QueueAssignmentValidationError, QueueAssignmentDisabledError } from './ai-queue-assignment.dto';

const SYSTEM = 'You explain nail-salon technician assignment recommendations for salon staff in one or two short, factual sentences. Do not invent facts. Never include customer names. Output plain text only.';

/** §18: the narrow slice of the platform this module uses. ai-queue-assignment.module binds it to AiPlatform. */
export interface QueueExplainPort {
  explain(req: { tenantId: string; userId: string | null; recommendation: unknown }): Promise<{ explanation: string; keyFactor: string } | null>;
}

export interface ExplanationResult { explanation: string; source: 'ai' | 'fallback'; provider?: string; model?: string; }

export class QueueExplanationService {
  constructor(
    private readonly repo: QueueAssignmentRepositoryPort,
    private readonly ai?: QueueExplainPort,
    private readonly entitlement?: QueueAssignmentEntitlementPort,
  ) {}

  private need(ctx: QueueAssignmentContext, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new QueueAssignmentForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, perm)) throw new QueueAssignmentForbiddenError('Missing ' + perm);
  }

  async explain(ctx: QueueAssignmentContext, recommendationId: string): Promise<ExplanationResult> {
    this.need(ctx, 'ai_queue_assignment.view');
    if (this.entitlement && !(await this.entitlement.isEnabled(ctx.tenantId))) throw new QueueAssignmentDisabledError();
    const rec = await this.repo.getRecommendation(ctx, recommendationId);
    if (!rec) throw new QueueAssignmentValidationError('RECOMMENDATION_NOT_FOUND');

    const fallback = deterministicExplanation(rec.envelope);
    if (!this.ai) return { explanation: sanitize(fallback), source: 'fallback' };

    try {
      const r = await this.ai.explain({ tenantId: ctx.tenantId, userId: ctx.userId ?? null, recommendation: explanationPromptData(rec.envelope) });
      const text = sanitize(r ? `${r.explanation} (${r.keyFactor})` : '');
      // Usage is recorded by the platform (§92) -- this module no longer writes its own row.
      if (!text) return { explanation: sanitize(fallback), source: 'fallback' };
      return { explanation: text, source: 'ai' };
    } catch {
      return { explanation: sanitize(fallback), source: 'fallback' };
    }
  }

}
