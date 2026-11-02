// ai-provider-task-gateway.ts — Remaining Production §30 (Oct 27 2026): the central AI gateway's door for a provider that is
// NOT a language model — today AWS Textract (receipt OCR, task 'ocr.receipt_extract'). AiPlatform.execute() is built around
// prompts, routing and schema validation of model text; an OCR adapter has none of that, but it must still pass the SAME
// platform controls as every other AI call instead of its own scattered checks:
//   1. the task registry (§9)          — only a declared task; its module decides the billing package (TASK_PACKAGE)
//   2. entitlement / quota (§92)       — evaluateAiAccess on the tenant's package, BEFORE the provider is contacted
//   3. safety + kill switch (§109–§113) — a task switched off by the tenant or suspended platform-wide stops here
//   4. provider health (§79/§85)       — the shared circuit breakers: an open circuit is not called
//   5. the call                        — bounded by the task's timeoutMs; success / failure recorded on the breaker
//   6. the usage ledger (§92)          — ai_usage_logs through the same AiUsageLogger, one row per call, never skipped,
//                                         never able to fail a call that succeeded
// Nothing here knows about receipts; the caller states the tenant unit (e.g. 1 scan) and the platform cost.
import { Logger } from '@nestjs/common';
import { evaluateAiAccess } from './ai-access-gate';
import { AiAccessDeniedError, type AiAccessRepoPort } from './ai-gated-completion';
import type { AiUsageLogger, AiUsageStatus } from './ai-gateway';
import { getAiPackage } from './ai-catalog';
import { TASK_PACKAGE, AiPlatformError, type AiEventPort } from './ai-platform';
import { resolveTask, type TaskDefinition } from './ai-task-registry';
import { evaluateSafety, type PlatformSafetyState, type TenantSafetySettings } from './ai-safety-policy';
import { resolveTenantSafety } from './ai-settings-store';
import { ProviderCircuitBreakers, classifyError } from './ai-provider-health';

/** Oct 27 2026 (check:silent-catch): the gateway's best-effort steps log what they skip — never a silent swallow */
const gatewayLog = new Logger('AiProviderTaskGateway');
const errText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 200);

export interface ProviderTaskRequest {
  taskKey: string; tenantId: string; userId: string | null; branchId?: string | null;
  /** the adapter's key, e.g. 'aws-textract' — the circuit-breaker and ledger name */
  provider: string; model?: string | null;
  safety?: TenantSafetySettings;
}
export interface ProviderTaskUsage { usageAmount: number; costMicroUsd: number }

export interface ProviderTaskGatewayDeps {
  accessRepo?: AiAccessRepoPort | null;
  usage: AiUsageLogger;
  breakers?: ProviderCircuitBreakers;
  platformSafety?: () => Promise<PlatformSafetyState>;
  /** N-4 / SD-23: the tenant's saved AI settings (the POS "turn off all AI" switch, disabled tasks, caps), per request */
  tenantSafety?: (tenantId: string, branchId: string | null) => Promise<TenantSafetySettings>;
  events?: AiEventPort | null;
  now?: () => number;
}

export class AiProviderTaskGateway {
  readonly breakers: ProviderCircuitBreakers;
  private readonly now: () => number;
  constructor(private readonly deps: ProviderTaskGatewayDeps) {
    this.breakers = deps.breakers ?? new ProviderCircuitBreakers();
    this.now = deps.now ?? Date.now;
  }

  /** Steps 1–3, once per job (before any provider): the declared task, the tenant's entitlement, the safety switches. */
  async admit(req: Omit<ProviderTaskRequest, 'provider' | 'model'>): Promise<{ task: TaskDefinition; packageCode: string }> {
    const task = resolveTask(req.taskKey);
    const packageCode = TASK_PACKAGE[task.module];
    if (!packageCode) throw new AiPlatformError('AI_PACKAGE_UNMAPPED', 500, `task ${task.key} (module ${task.module}) has no billing package (§92)`);
    if (this.deps.accessRepo) {
      const decision = evaluateAiAccess(await this.deps.accessRepo.loadSnapshot(req.tenantId, packageCode, req.userId, { branchId: req.branchId ?? null }));
      if (!decision.allowed) {
        await this.log(req, packageCode, task, null, null, decision.limitExceeded ? 'blocked_limit' : decision.reason === 'permission_denied' ? 'blocked_permission' : 'blocked_unpaid', { usageAmount: 0, costMicroUsd: 0 }, decision.reason);
        throw new AiAccessDeniedError(decision);
      }
    }
    // the platform switchboard read is best effort (the tenant's own safety settings still apply) — but never silent
    const platform = (await this.deps.platformSafety?.().catch((e: unknown) => { gatewayLog.warn(`platform safety state unavailable for ${task.key}: ${errText(e)}`); return undefined; })) ?? {};
    const tenant = await resolveTenantSafety(this.deps.tenantSafety, req.tenantId, req.branchId ?? null, req.safety, (m) => gatewayLog.warn(m));
    const safety = evaluateSafety(task.key, { tenant, platform });
    if (!safety.allowed) {
      await this.log(req, packageCode, task, null, null, 'blocked_permission', { usageAmount: 0, costMicroUsd: 0 }, `safety: ${safety.reasons.join('; ')}`);
      await this.emit('ai.safety_event_detected', { tenantId: req.tenantId, taskKey: task.key, kind: 'task_disabled', boundBy: safety.boundBy });
      throw new AiPlatformError('AI_TASK_DISABLED', 403, `AI task ${task.key} is switched off: ${safety.reasons[safety.reasons.length - 1]}`);
    }
    return { task, packageCode };
  }

  /** Steps 4–6 for ONE provider attempt (call admit() first). `usageOf` turns the provider's answer into the ledger row's
   *  tenant unit and platform cost (null: the adapter did nothing billable). A failed call is ledgered as provider_error (it may have been billed) and rethrown. */
  async call<T>(req: ProviderTaskRequest, admitted: { task: TaskDefinition; packageCode: string }, run: () => Promise<T>, usageOf: (r: T) => ProviderTaskUsage | null): Promise<T> {
    const { task, packageCode } = admitted;
    if (!this.breakers.isOpen(req.provider)) {
      throw new AiPlatformError('AI_PROVIDER_UNAVAILABLE', 503, `${req.provider} is unavailable (circuit open after repeated failures)`);
    }
    const t0 = this.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      const r = await Promise.race([run(), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('ai_provider_timeout')), task.timeoutMs); timer.unref?.(); })]);
      this.breakers.recordSuccess(req.provider, this.now() - t0);
      const u = usageOf(r);   // null = the adapter answered "nothing done" (no ledger row: nothing was billed)
      if (u) await this.log(req, packageCode, task, req.provider, req.model ?? null, 'success', u, null);
      return r;
    } catch (e) {
      this.breakers.recordFailure(req.provider, classifyError(e));
      await this.log(req, packageCode, task, req.provider, req.model ?? null, 'provider_error', { usageAmount: 0, costMicroUsd: 0 }, String((e as Error)?.message ?? e).slice(0, 300));
      throw e;
    } finally { if (timer) clearTimeout(timer); }
  }

  private async log(req: Pick<ProviderTaskRequest, 'tenantId' | 'userId' | 'branchId'>, packageCode: string, task: TaskDefinition, provider: string | null, model: string | null, status: AiUsageStatus, u: ProviderTaskUsage, error: string | null): Promise<void> {
    try {
      await this.deps.usage.log({ tenantId: req.tenantId, userId: req.userId, packageCode, action: task.key, modelProvider: provider, modelName: model, inputTokens: 0, outputTokens: 0,
        usageUnit: getAiPackage(packageCode)?.usageUnit ?? 'calls', usageAmount: status === 'success' ? u.usageAmount : 0, costMicroUsd: u.costMicroUsd, status, errorMessage: error, createdAt: new Date(this.now()).toISOString(), branchId: req.branchId ?? null });
    } catch (e) { gatewayLog.error(`usage ledger write failed (${status}, ${task.key}, tenant ${req.tenantId}): ${errText(e)}`); /* §92: the ledger never fails a call — logged for reconciliation */ }
  }
  private async emit(eventType: string, payload: Record<string, unknown>): Promise<void> {
    try { await this.deps.events?.publish(eventType, payload); } catch (e) { gatewayLog.warn(`event ${eventType} not published: ${errText(e)}`); /* announcing is not the work */ }
  }
}
