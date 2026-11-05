// ai-platform.ts — Constitution 10 §6–§8: THE ONE ENTRY POINT.
//
// Every AI call in the application goes through `AiPlatform.execute()`. There is no second door. What a call
// passes through, in order, and which section demands each step:
//
//   1. resolveTask            §9   an undeclared task is refused before anything else happens
//   2. entitlement            §92  the tenant's package must allow this; blocked calls never reach a provider
//   3. prompt version         §23  the version that serves THIS tenant (rollout-aware)
//   4. context build          §56  tenant-safe, classified, redacted, budgeted
//   5. render                 §26  typed variables, untrusted delimiting
//   6. route                  §12  provider+model from task shape, tenant policy, health
//   7. provider call          §79  breaker-aware, error-classified, one transient retry, compatible failover
//   8. validate               §73  schema; one bounded repair (§74)
//   9. confidence + approval  §75  risk level and approval policy decide COMPLETED vs NEEDS_REVIEW
//  10. usage + cost           §92  recorded with real token pricing; never skipped, never fails the call
//
// §285: the result is COMPLETED only after 8 and 10. A provider 200 with a bad body is FAILED_VALIDATION (§286).
// §303: the platform never returns a fake result. Every failure is a typed error the caller sees.
import { createHash } from 'node:crypto';
import type { AiProvider, AiUsageLogger } from './ai-gateway';
import type { AiAccessRepoPort } from './ai-gated-completion';
import { AiAccessDeniedError } from './ai-gated-completion';
import { evaluateAiAccess } from './ai-access-gate';
import { getAiPackage } from './ai-catalog';
import { resolveTask, type TaskDefinition, type RiskLevel, type ApprovalPolicy } from './ai-task-registry';
import { route, NoRoutableModelError, type RoutingDecision, type RoutingTenantPolicy } from './ai-model-router';
import { modelCost } from './ai-model-registry';
import { priceVersionAt } from './ai-pricing';
import { ProviderCircuitBreakers, classifyError, isRetryable, type ErrorClass } from './ai-provider-health';
import { selectVersion, render, type PromptStore, type PromptVersion } from './ai-prompt-registry';
import { buildContext, type ContextField } from './ai-context-builder';
import { validateWithRepair, confidenceOf, isLowConfidence, AiOutputSchemaInvalid, type CompletionStatus } from './ai-output-schemas';
import { evaluateSafety, permitsAutomaticAction, type TenantSafetySettings, type PlatformSafetyState, type AutomationLevel } from './ai-safety-policy';

// ---------------------------------------------------------------------------------------------------------------
// §8 request / result envelopes
// ---------------------------------------------------------------------------------------------------------------
export interface AIRequest {
  taskKey: string;
  tenantId: string;
  branchId?: string | null;
  userId: string | null;
  /** §92: the catalog package this call is billed against. Derived from the task's module when omitted. */
  packageCode?: string;
  /** §26: the prompt's typed variables. Untrusted ones are delimited by the registry, not by the caller. */
  variables: Record<string, unknown>;
  /** §56: extra classified context fields (optional). Their values are merged into `variables` after redaction. */
  context?: ContextField[];
  /** §52/§53 tenant AI settings slice. */
  tenantPolicy?: RoutingTenantPolicy;
  /** §109/§110 tenant safety settings. They may only tighten; the engine enforces that. */
  safety?: TenantSafetySettings;
  /** §113 platform state (kill switch, suspended tasks). */
  platformSafety?: PlatformSafetyState;
  /** §87: idempotency. Same key + same tenant + same task → the platform returns the stored result if present. */
  idempotencyKey?: string;
  /** Correlation id for the trace (§116). Generated when absent. */
  requestId?: string;
  /** §153: tasks that need consent declare it; the caller proves it here. */
  consent?: { kind: string; recordedAt: string };
}

export interface AIResult<T = unknown> {
  requestId: string;
  taskKey: string;
  tenantId: string;
  status: CompletionStatus;
  /** Present only when status is COMPLETED or NEEDS_REVIEW — never on a failure. */
  data?: T;
  confidence?: number;
  risk: RiskLevel;
  approval: ApprovalPolicy;
  /** §111: the effective automation level for this tenant and task — what the CALLER may do with `data`. */
  automation: AutomationLevel;
  /** §111: true only when the platform, the tenant and the kill switches all permit acting without a human. */
  mayActAutomatically: boolean;
  /** §22/§78/§242: exactly what produced this. */
  provenance: { provider: string; model: string; promptKey: string; promptVersion: number; contentSha256: string; routingPolicyVersion: string; repaired: boolean; attempts: number; failover?: RoutingDecision['fallback'] };
  usage: { inputTokens: number; outputTokens: number; costMicroUsd: number; latencyMs: number };
  /** §116 trace of what the context builder did — classes and counts, never values. */
  contextManifest: ReturnType<typeof buildContext>['manifest'];
  warnings: string[];
}

export class AiPlatformError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly cause?: unknown) { super(message); this.name = 'AiPlatformError'; }
}

/** §17: how the platform obtains an adapter for a (provider, model). Returns null when that provider is not configured here. */
export type ProviderPool = (provider: string, model: string) => AiProvider | null;

/**
 * §161/§164: the platform announces AI lifecycle FACTS. It does not hold a database handle, so it publishes
 * through this port; the Nest wiring binds it to the outbox inside the caller's transaction where there is one,
 * and to a no-op in dev/tests. §83/§115: a payload carries ids, task keys, counts and costs — never prompt or
 * response text, which the outbox's own FORBIDDEN_EVENT_PAYLOAD_KEYS check would reject anyway.
 */
export interface AiEventPort {
  publish(eventType: string, payload: Record<string, unknown>): Promise<void>;
}

export interface AiPlatformDeps {
  /** Constitution 7 §34 / AI §113 — the platform-wide kill switch state, read per request (cached by the reader).
   *  Before this, nothing ever supplied platformSafety, so the platform auto-action kill switch could not be turned on. */
  platformSafety?: () => Promise<PlatformSafetyState>;
  accessRepo: AiAccessRepoPort;
  usage: AiUsageLogger;
  prompts: PromptStore;
  providers: ProviderPool;
  breakers?: ProviderCircuitBreakers;
  /** §87 optional idempotency store. */
  idempotency?: { get(key: string): Promise<AIResult | null>; put(key: string, r: AIResult): Promise<void> };
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** §116 hook for the trace sink. Receives no prompt text. */
  onTrace?: (t: AiTrace) => void;
  /** §161 AI lifecycle events. Best-effort: an event that fails to publish never fails a completed AI call. */
  events?: AiEventPort;
}

export interface AiTrace {
  requestId: string; taskKey: string; tenantId: string; status: CompletionStatus | 'BLOCKED' | 'ERROR';
  provider?: string; model?: string; promptVersion?: number; latencyMs: number; errorClass?: ErrorClass | string; attempts: number;
}

/** §92: the catalog package a task is billed against. Explicit in the request beats this default. */
export const TASK_PACKAGE: Readonly<Record<string, string>> = Object.freeze({
  'ai-review-reputation': 'ai_review_reputation_assistant', 'ai-voice-transcription': 'ai_voice_transcription', 'ai-ocr-receipt': 'ai_ocr_receipt_scanner',
  'ai-analytics-forecasting': 'ai_analytics_forecasting', 'ai-queue-assignment': 'ai_queue_technician_assignment', 'ai-scheduling-optimizer': 'ai_scheduling_optimizer',
  'deposit-reconciliation': 'ai_fraud_money_protection', 'ai-money-protection': 'ai_fraud_money_protection', 'ai': 'ai_reception_copilot',
  'ai-marketing': 'ai_marketing_assistant', 'ai-business': 'ai_business_assistant', 'ai-checkout-upsell': 'ai_checkout_upsell_assistant',
});

const TRANSIENT_RETRY_DELAY_MS = 250;

export class AiPlatform {
  private readonly breakers: ProviderCircuitBreakers;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  constructor(private readonly deps: AiPlatformDeps) {
    this.breakers = deps.breakers ?? new ProviderCircuitBreakers();
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? Date.now;
  }

  async execute<T = unknown>(req: AIRequest): Promise<AIResult<T>> {
    const started = this.now();
    const requestId = req.requestId ?? createHash('sha256').update(`${req.tenantId}:${req.taskKey}:${started}:${Math.random()}`).digest('hex').slice(0, 16);
    if (!req.tenantId) throw new AiPlatformError('AI_TENANT_REQUIRED', 400, '§7: no AI request without validated tenant context');

    // 1. §9
    const task = resolveTask(req.taskKey);
    const packageCode = req.packageCode ?? TASK_PACKAGE[task.module];
    if (!packageCode) throw new AiPlatformError('AI_PACKAGE_UNMAPPED', 500, `task ${task.key} (module ${task.module}) has no billing package (§92)`);
    if (task.capability === 'audio.transcribe' && !req.consent) throw new AiPlatformError('AI_CONSENT_REQUIRED', 400, '§153: transcription requires recorded consent');

    // §87 idempotency
    const idemKey = req.idempotencyKey ? `${req.tenantId}:${task.key}:${req.idempotencyKey}` : null;
    if (idemKey && this.deps.idempotency) { const prior = await this.deps.idempotency.get(idemKey); if (prior) return prior as AIResult<T>; }

    // 2. §92 entitlement — BEFORE any provider, prompt, or context work.
    const snapshot = await this.deps.accessRepo.loadSnapshot(req.tenantId, packageCode, req.userId);
    const decision = evaluateAiAccess(snapshot);
    if (!decision.allowed) {
      await this.log(req, packageCode, decision.limitExceeded ? 'blocked_limit' : decision.reason === 'permission_denied' ? 'blocked_permission' : 'blocked_unpaid', null, 0, 0, 0, decision.reason);
      this.trace({ requestId, taskKey: task.key, tenantId: req.tenantId, status: 'BLOCKED', latencyMs: this.now() - started, attempts: 0, errorClass: decision.reason });
      throw new AiAccessDeniedError(decision);
    }

    // §161: the request is a fact, announced before any work is done.
    await this.emit('ai.job_requested', { requestId, tenantId: req.tenantId, branchId: req.branchId ?? null, module: task.module, taskKey: task.key, riskLevel: task.risk, actorUserId: req.userId });

    // 2b. §109/§110/§113 safety policy. A task switched off — by the tenant, or suspended platform-wide —
    // stops here, BEFORE a prompt is rendered or a provider is contacted.
    const platformSafety = req.platformSafety ?? (await this.deps.platformSafety?.().catch(() => undefined)) ?? {};
    const safety = evaluateSafety(task.key, { tenant: req.safety, platform: platformSafety });
    if (!safety.allowed) {
      await this.log(req, packageCode, 'blocked_permission', null, 0, 0, 0, `safety: ${safety.reasons.join('; ')}`);
      this.trace({ requestId, taskKey: task.key, tenantId: req.tenantId, status: 'BLOCKED', latencyMs: this.now() - started, attempts: 0, errorClass: 'safety_off' });
      await this.emit('ai.safety_event_detected', { requestId, tenantId: req.tenantId, taskKey: task.key, kind: 'task_disabled', boundBy: safety.boundBy });
      throw new AiPlatformError('AI_TASK_DISABLED', 403, `AI task ${task.key} is switched off: ${safety.reasons[safety.reasons.length - 1]}`);
    }

    await this.emit('ai.job_started', { requestId, tenantId: req.tenantId, taskKey: task.key, automation: safety.automation });

    // 3–5. prompt + context + render
    const version = await selectVersion(this.deps.prompts, task.key, req.tenantId);
    const built = buildContext(req.tenantId, req.context ?? [], { maxTotalChars: 24_000 });
    const rendered = render(version, { ...built.values, ...req.variables });

    // 6–7. route + call, with §79 failover on a compatible alternative and §80 refusal for HIGH.
    const call = await this.callWithFailover(task, version, rendered, req, started);

    // 8. §73/§74 validate, one bounded repair through the SAME provider+model at temperature 0.
    let validated: { value: T; repaired: boolean; attempts: number };
    try {
      validated = await validateWithRepair<T>(task.outputSchema, call.text, async (repair) => {
        const r = await call.provider.complete({ system: rendered.system, prompt: repair, maxTokens: task.maxOutputTokens });
        call.inputTokens += r.inputTokens; call.outputTokens += r.outputTokens;
        return r.text;
      });
    } catch (e) {
      const cost = this.cost(call.decision.model, call.inputTokens, call.outputTokens);
      // §286: provider succeeded, result invalid → FAILED_VALIDATION. The provider call still cost money and is logged as such.
      await this.log(req, packageCode, 'failed', call.decision, call.inputTokens, call.outputTokens, cost, e instanceof AiOutputSchemaInvalid ? e.message : String(e));
      this.trace({ requestId, taskKey: task.key, tenantId: req.tenantId, status: 'FAILED_VALIDATION', provider: call.decision.provider, model: call.decision.model, promptVersion: version.version, latencyMs: this.now() - started, attempts: call.attempts + 1, errorClass: 'AI_OUTPUT_SCHEMA_INVALID' });
      await this.emit('ai.job_failed', { requestId, tenantId: req.tenantId, taskKey: task.key, reason: 'FAILED_VALIDATION', provider: call.decision.provider, model: call.decision.model, costMicroUsd: cost });
      throw e;
    }

    // 9. §75/§76/§41 status
    const confidence = confidenceOf(task.outputSchema, validated.value);
    const warnings: string[] = [];
    let status: CompletionStatus = 'COMPLETED';
    if (task.approval !== 'NO_APPROVAL') { status = 'NEEDS_REVIEW'; }
    if (isLowConfidence(confidence)) { status = 'NEEDS_REVIEW'; warnings.push(`low confidence ${confidence} — human review only (§76)`); }
    // §111: an automation level below LIMITED_AUTOMATION means a human is in the loop whatever the result says.
    if (!permitsAutomaticAction(safety) && status === 'COMPLETED' && safety.automation !== 'AUTOMATIC') {
      if (safety.automation === 'SUGGEST_ONLY' || safety.automation === 'DRAFT' || safety.automation === 'APPROVAL_REQUIRED') { status = 'NEEDS_REVIEW'; warnings.push(`automation level ${safety.automation} — a human decides (§111)`); }
    }
    if (safety.boundBy.endsWith('kill_switch')) warnings.push(safety.reasons[safety.reasons.length - 1]);
    if (validated.repaired) warnings.push('output required one schema repair (§74)');
    if (call.decision.fallback) warnings.push(`provider failover: ${call.decision.fallback.fromProvider} → ${call.decision.provider} (${call.decision.fallback.reason})`);

    // 10. §92 usage + real cost. Best-effort, never fails a completed call — but it is attempted BEFORE we return.
    const latencyMs = this.now() - started;
    const costMicroUsd = this.cost(call.decision.model, call.inputTokens, call.outputTokens);
    await this.log(req, packageCode, 'success', call.decision, call.inputTokens, call.outputTokens, costMicroUsd, null);

    const result: AIResult<T> = {
      requestId, taskKey: task.key, tenantId: req.tenantId, status, data: validated.value, confidence, risk: task.risk, approval: task.approval,
      automation: safety.automation, mayActAutomatically: permitsAutomaticAction(safety) && status === 'COMPLETED',
      provenance: { provider: call.decision.provider, model: call.decision.model, promptKey: version.promptKey, promptVersion: version.version, contentSha256: version.contentSha256, routingPolicyVersion: call.decision.routingPolicyVersion, repaired: validated.repaired, attempts: call.attempts + (validated.repaired ? 1 : 0), failover: call.decision.fallback },
      usage: { inputTokens: call.inputTokens, outputTokens: call.outputTokens, costMicroUsd, latencyMs },
      contextManifest: built.manifest, warnings,
    };
    this.trace({ requestId, taskKey: task.key, tenantId: req.tenantId, status, provider: result.provenance.provider, model: result.provenance.model, promptVersion: version.version, latencyMs, attempts: result.provenance.attempts });
    // §161: usage is its own fact — Constitution 8's ai.usage_ledger consumer already listens for it.
    await this.emit('ai.usage_recorded', { requestId, tenantId: req.tenantId, taskKey: task.key, packageCode, provider: call.decision.provider, model: call.decision.model, inputTokens: call.inputTokens, outputTokens: call.outputTokens, costMicroUsd, latencyMs });
    await this.emit('ai.job_completed', { requestId, tenantId: req.tenantId, taskKey: task.key, status, confidence: confidence ?? null, automation: safety.automation, repaired: validated.repaired });
    // §161/§165: a result a human must act on is announced so the Notification Service can raise it. The AI
    // module does not message anyone itself (§165 — no direct APNs/Twilio/email from an AI module).
    if (status === 'NEEDS_REVIEW') await this.emit('ai.approval_required', { requestId, tenantId: req.tenantId, branchId: req.branchId ?? null, taskKey: task.key, module: task.module, riskLevel: task.risk, reason: warnings[0] ?? 'human review required' });
    if (idemKey && this.deps.idempotency) await this.deps.idempotency.put(idemKey, result).catch(() => undefined);
    return result;
  }

  /** §79/§83/§85: one transient retry on the chosen provider, then a compatible alternative; §80 never for HIGH. */
  private async callWithFailover(task: TaskDefinition, version: PromptVersion, rendered: ReturnType<typeof render>, req: AIRequest, started: number) {
    let excludeProvider: string | undefined;
    let attempts = 0;
    let lastError: unknown;
    for (let hop = 0; hop < 3; hop++) {
      let decision: RoutingDecision;
      try { decision = route(task, { tenant: req.tenantPolicy, health: this.breakers, env: this.env, excludeProvider }); }
      catch (e) { if (e instanceof NoRoutableModelError && lastError) throw new AiPlatformError('AI_PROVIDER_UNAVAILABLE', 503, `${e.message}; last provider error: ${String((lastError as Error)?.message ?? lastError)}`, lastError); throw e; }
      const provider = this.deps.providers(decision.provider, decision.model);
      if (!provider) { excludeProvider = decision.provider; lastError = new Error(`${decision.provider} has no adapter configured here`); continue; }
      for (let attempt = 0; attempt < 2; attempt++) {
        attempts++;
        const t0 = this.now();
        try {
          const r = await provider.complete({ system: rendered.system, prompt: rendered.prompt, maxTokens: task.maxOutputTokens });
          this.breakers.recordSuccess(decision.provider, this.now() - t0);
          return { text: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, decision, provider, attempts };
        } catch (e) {
          lastError = e;
          const cls = classifyError(e);
          this.breakers.recordFailure(decision.provider, cls);
          if (!isRetryable(cls)) throw new AiPlatformError('AI_PROVIDER_REJECTED', 502, `provider ${decision.provider} rejected the request permanently (${cls}): ${String((e as Error)?.message ?? e)}`, e);
          if (attempt === 0 && cls !== 'RATE_LIMITED') { await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS)); continue; }
          break;   // second failure on this provider → failover hop
        }
      }
      // §80: the router itself throws HighRiskFailoverRefused when a HIGH task would move provider.
      excludeProvider = decision.provider;
    }
    void started;
    throw new AiPlatformError('AI_PROVIDER_UNAVAILABLE', 503, `all providers failed for ${task.key}: ${String((lastError as Error)?.message ?? lastError)}`, lastError);
  }

  /**
   * §96: real pricing from the model registry, in micro-USD.
   *
   * §218: the usage row also records WHICH price version valued it. Recomputing cost from today's table is how
   * a provider rate change silently re-values last quarter; a stored version id means a historical row still
   * knows what it was charged under, whatever the table says later.
   */
  private cost(model: string, inTok: number, outTok: number): number {
    const p = modelCost(model);
    return Math.round((inTok * p.inPerM + outTok * p.outPerM) / 1_000_000 * 1_000_000);
  }

  private priceVersionId(model: string | null): string | null {
    if (!model) return null;
    return priceVersionAt(model, new Date(this.now()))?.id ?? null;
  }

  private log(req: AIRequest, packageCode: string, status: 'success' | 'failed' | 'blocked_limit' | 'blocked_permission' | 'blocked_unpaid', d: RoutingDecision | null, inTok: number, outTok: number, costMicroUsd: number, error: string | null) {
    const pkg = getAiPackage(packageCode);
    return this.deps.usage.log({
      tenantId: req.tenantId, userId: req.userId, packageCode, action: req.taskKey,
      modelProvider: d?.provider ?? null, modelName: d?.model ?? null,
      inputTokens: inTok, outputTokens: outTok, usageUnit: pkg?.usageUnit ?? 'calls', usageAmount: status === 'success' ? 1 : 0,
      costMicroUsd, status, errorMessage: error, createdAt: new Date(this.now()).toISOString(),
      priceVersionId: this.priceVersionId(d?.model ?? null),
    }).catch(() => undefined);
  }

  private trace(t: AiTrace) { try { this.deps.onTrace?.(t); } catch { /* a trace sink must never affect a call */ } }

  /** §161. Best-effort by design: an unpublished event must never fail an AI call that already succeeded. */
  private async emit(eventType: string, payload: Record<string, unknown>): Promise<void> {
    try { await this.deps.events?.publish(eventType, payload); } catch { /* announcing is not the work */ }
  }

  /** §173 dashboard hook. */
  providerHealth() { return this.breakers.snapshot(); }
}
