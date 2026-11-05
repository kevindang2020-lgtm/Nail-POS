// ai-money-protection-explain.service.ts — advisory AI explanation endpoint. The AI can ONLY return text through
// the completion port; it has no tools and cannot touch money, status, or another tenant. Output is always
// sanitized (finalizeExplanation) so an accusation can never reach the user, and any gateway error falls back to
// a deterministic evidence-based summary.
// Constitution 10 Phase 23: this service held an AiGatewayService directly. It relied on the controller's
// permission gate but wrote NO usage row -- a HIGH-risk explanation that cost the platform money and attributed
// it to nobody. It now goes through AiPlatform.execute('money.explain_alert'). KEPT deliberately: the
// deterministic fallback (an AI outage must never break alert review) and finalizeExplanation's accusation
// filter, which is defence in depth over schema validation -- a schema guarantees SHAPE, not acceptable words.
import type { MoneyProtectionContext } from './ai-money-protection.dto';
import type { MoneyProtectionRepositoryPort } from './ai-money-protection.repository';
import { MoneyProtectionForbiddenError, MoneyProtectionValidationError } from './ai-money-protection.service';
import { buildExplainPrompt, finalizeExplanation, deterministicFallback } from './ai-money-protection-explain';

/**
 * The exact subset of the AI Platform this module uses (§18: a module depends on an interface, not a class).
 * Tests inject a deterministic fake; ai-money-protection.module binds it to AiPlatform.
 */
export interface AiExplainPort {
  explain(req: { tenantId: string; userId: string | null; alertJson: unknown }): Promise<{ explanation: string; firstCheck: string } | null>;
}

export interface ExplanationResult { summary: string; source: 'ai' | 'fallback'; disclaimer: string; }

export class MoneyProtectionExplainService {
  constructor(
    private readonly alerts: MoneyProtectionRepositoryPort,
    private readonly ai: AiExplainPort,
  ) {}

  async explainAlert(ctx: MoneyProtectionContext, alertId: string): Promise<ExplanationResult> {
    if (!ctx?.tenantId) throw new MoneyProtectionValidationError('Missing tenant context');
    if (!(ctx.permissions || []).includes('ai_money_protection.view')) throw new MoneyProtectionForbiddenError();

    const [alert] = await this.alerts.getAlertsByIds(ctx, [alertId]); // tenant-scoped
    if (!alert) throw new MoneyProtectionValidationError('ALERT_NOT_FOUND');

    const built = buildExplainPrompt(alert);
    if (!built) return { summary: deterministicFallback(alert), source: 'fallback', disclaimer: 'Advisory only — possible anomaly requiring human review, not proof of misconduct.' };

    let modelText: string | null = null;
    try {
      // Constitution 10 Phase 23: the platform renders the registered money.explain_alert prompt version and
      // validates the result against money.explanation.v1. buildExplainPrompt's payload (counts and amounts
      // only, with its own FORBIDDEN_IN_PROMPT guard) is the task's declared variable.
      const r = await this.ai.explain({ tenantId: ctx.tenantId, userId: (ctx as { userId?: string | null }).userId ?? null, alertJson: built.payload });
      modelText = r ? `${r.explanation} First check: ${r.firstCheck}` : null;
    } catch {
      modelText = null; // platform unavailable, unentitled, or output invalid -> deterministic fallback
                        // (an AI outage must never break alert review)
    }
    return finalizeExplanation(modelText, alert);
  }
}
