// ai-gated-completion.ts — a completion port that ENFORCES the AI entitlement and METERS the call.
//
// ── The hole this closes ─────────────────────────────────────────────────────────────────────────────────
// `AiAssistantService.run()` is the platform's gate: it loads the access snapshot, calls `evaluateAiAccess()`,
// blocks BEFORE the provider call, and writes `ai_usage_logs`. Modules that route their model calls through it
// are gated and metered for free.
//
// But `run()` takes a single `prompt` — it has no place for a module's own SYSTEM prompt. So a module with a
// bespoke system prompt (ai-marketing's draft generator, for one) could not use it, and reached straight for
// `AiGatewayService` instead. That path calls the model, is billed to us, and is checked against **nothing**:
// no subscription, no trial expiry, no usage limit, and no usage row. A tenant whose $59/mo Marketing package
// was cancelled could keep generating drafts indefinitely, for free, and it would appear on no usage screen.
//
// This is the missing shape: same gate, same meter, but it carries `system` through. Any module that needs its
// own system prompt should depend on THIS, not on AiGatewayService.
//
// ── It fails closed ──────────────────────────────────────────────────────────────────────────────────────
// A denial throws before the provider is touched — an unentitled tenant never costs us a model call. A provider
// error is logged as `provider_error` (it may still have been billed) and rethrown. Nothing here can run a
// model for a tenant the gate did not allow.
import { evaluateAiAccess, accessReasonLabel, type AiAccessDecision, type AiAccessSnapshot } from './ai-access-gate';
import { getAiPackage } from './ai-catalog';
import type { AiGatewayService, AiUsageLogger, AiUsageStatus } from './ai-gateway';

/** Same snapshot loader AiAssistantService uses — one source of truth for "may this tenant run AI?". */
export interface AiAccessRepoPort {
  loadSnapshot(tenantId: string, packageCode: string, userId: string | null): Promise<AiAccessSnapshot>;
}

export interface GatedCompletionRequest {
  tenantId: string;
  userId: string | null;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Usage `action` (defaults to 'invoke'), e.g. 'generate_draft'. */
  action?: string;
}

export interface GatedCompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

/** Thrown when the tenant's AI package does not entitle them to this call. Carries the real reason. */
export class AiAccessDeniedError extends Error {
  readonly status: number;
  constructor(readonly decision: AiAccessDecision) {
    super(accessReasonLabel(decision.reason));
    this.name = 'AiAccessDeniedError';
    // A usage-limit denial is a different remedy from an unpaid one — 429 (slow down / buy overage) vs 403
    // (fix your subscription). Collapsing both into one status tells the tenant nothing actionable.
    this.status = decision.limitExceeded ? 429 : 403;
  }
}

const blockedStatus = (d: AiAccessDecision): AiUsageStatus =>
  d.limitExceeded ? 'blocked_limit' : d.reason === 'permission_denied' ? 'blocked_permission' : 'blocked_unpaid';

export class GatedAiCompletion {
  constructor(
    private readonly repo: AiAccessRepoPort,
    private readonly gateway: AiGatewayService,
    private readonly logger: AiUsageLogger,
    private readonly packageCode: string,
  ) {}

  private log(req: GatedCompletionRequest, status: AiUsageStatus, r: Partial<GatedCompletionResult>, amount: number, error?: string) {
    const pkg = getAiPackage(this.packageCode);
    return this.logger.log({
      tenantId: req.tenantId,
      userId: req.userId,
      packageCode: this.packageCode,
      action: req.action || 'invoke',
      modelProvider: r.provider ?? null,
      modelName: r.model ?? null,
      inputTokens: r.inputTokens ?? 0,
      outputTokens: r.outputTokens ?? 0,
      // The unit the CATALOG sells this package in — the entitlement counter compares successful rows against
      // `includedUsageLimit`, so the unit here has to be the one the tenant actually bought.
      usageUnit: pkg?.usageUnit ?? 'calls',
      usageAmount: amount,
      costMicroUsd: 0,          // token pricing is not modelled per-provider; 0 is honest, an invented figure is not
      status,
      errorMessage: error ?? null,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);  // telemetry is best-effort; it must never fail a call that already succeeded
  }

  async complete(req: GatedCompletionRequest): Promise<GatedCompletionResult> {
    const snapshot = await this.repo.loadSnapshot(req.tenantId, this.packageCode, req.userId);
    const decision = evaluateAiAccess(snapshot);

    if (!decision.allowed) {
      // Blocked BEFORE the provider is touched: an unentitled tenant never costs us a model call. The blocked
      // attempt is still recorded (that is what the blocked_* statuses are for) but consumes no allowance.
      await this.log(req, blockedStatus(decision), {}, 0, decision.reason);
      throw new AiAccessDeniedError(decision);
    }

    try {
      const r = await this.gateway.complete({ system: req.system, prompt: req.prompt, maxTokens: req.maxTokens });
      const out: GatedCompletionResult = {
        text: (r as any).text ?? '',
        inputTokens: (r as any).inputTokens ?? 0,
        outputTokens: (r as any).outputTokens ?? 0,
        provider: (r as any).provider ?? this.gateway.providerName,
        model: (r as any).model ?? this.gateway.modelName,
      };
      await this.log(req, 'success', out, 1);
      return out;
    } catch (e: any) {
      // The provider may well have billed us for a call that then failed, so it is recorded — but it does NOT
      // consume the tenant's included allowance, because they got nothing for it.
      await this.log(req, 'provider_error', {}, 0, e?.message ?? 'provider_error');
      throw e;
    }
  }
}
