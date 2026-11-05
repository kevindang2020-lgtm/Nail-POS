// ai-entitlement.guard.ts — one shared gate for "has this tenant actually paid for this AI package?".
//
// ── The gap this closes ──────────────────────────────────────────────────────────────────────────────────
// RolePermissionGuard answers *who you are* (RBAC). Nothing answered *have you paid*. Eight billable AI
// modules — analytics-forecasting ($79/mo), scheduling-optimizer ($39), checkout-upsell ($49), inventory ($39),
// customer-profile ($39), review-reputation ($39), booking ($49), phone/voice-booking ($99) — do pure
// computation, so they cost us nothing per call. But a tenant who CANCELS one keeps using it, and their
// included-usage limits (1000 runs, 500 runs, …) are unenforceable because nothing meters them. They are
// effectively free after the first month.
//
// ── Why this ships in OBSERVE mode by default ────────────────────────────────────────────────────────────
// Turning enforcement on REVOKES A FEATURE FROM LIVE TENANTS. That is a pricing decision, not a bug fix, and it
// is not one an engineer should make silently in a refactor. So:
//
//   AI_ENTITLEMENT_ENFORCEMENT=off       guard does nothing at all
//   AI_ENTITLEMENT_ENFORCEMENT=observe   (DEFAULT) allows the call, but RECORDS the would-be denial in
//                                        ai_usage_logs as blocked_* — so you can see exactly who would break,
//                                        and how often, BEFORE you change anyone's access
//   AI_ENTITLEMENT_ENFORCEMENT=enforce   denies: 403 unpaid/cancelled/expired, 429 over-limit
//
// Observe mode is the whole point: it turns "should we gate these?" from a guess into a number you can read off
// the AI Usage screen. Nothing about a tenant's access changes until someone deliberately sets `enforce`.
//
// ── It is opt-in per controller ──────────────────────────────────────────────────────────────────────────
// Registered as a global APP_GUARD, but it no-ops on any handler that does not carry @RequiresAiPackage(...).
// So it can never accidentally gate a public route, a webhook, or a Super Admin surface.
import { evaluateAiAccess, accessReasonLabel, AI_USAGE_LIMIT_REACHED, type AiAccessDecision, type AiAccessSnapshot } from '../ai/ai-access-gate';
import { getAiPackage } from '../ai/ai-catalog';
import { type AiUsageLogger, type AiUsageStatus } from '../ai/ai-gateway';
import { CanActivate, ExecutionContext, Injectable, ForbiddenException, HttpException, HttpStatus, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isPlatformPrincipal, EntitlementService, type EntitlementSource } from '@aipowersalon/permissions';

/** BUILD_PLAN Phase 12 (#13): the AI package check is the 'ai_package' source of the ONE EntitlementService. Not
 *  cacheable — the included-usage limit moves with every call, so the snapshot is read fresh each time (as before). */
export const AI_PACKAGE_KIND = 'ai_package';
export function aiPackageSource(repo: AiEntitlementRepo): EntitlementSource<AiAccessDecision, { userId: string | null }> {
  return { kind: AI_PACKAGE_KIND, cacheable: false, decide: async (tenantId, packageCode, c) => evaluateAiAccess(await repo.loadSnapshot(tenantId, packageCode, c?.userId ?? null)) };
}

export const AI_PACKAGE_KEY = 'ai_package_code';

/** Declare the AI package a controller (or handler) requires. Absent → this guard does nothing. */
export const RequiresAiPackage = (packageCode: string) => SetMetadata(AI_PACKAGE_KEY, packageCode);

export interface AiEntitlementRepo {
  loadSnapshot(tenantId: string, packageCode: string, userId: string | null): Promise<AiAccessSnapshot>;
}

export type EnforcementMode = 'off' | 'observe' | 'enforce';

/** Default is `observe`: visibility first, and nobody's access changes until someone chooses `enforce`. */
export function enforcementMode(env: NodeJS.ProcessEnv = process.env): EnforcementMode {
  const v = String(env.AI_ENTITLEMENT_ENFORCEMENT ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'enforce') return v;
  return 'observe';
}

const blockedStatus = (d: AiAccessDecision): AiUsageStatus =>
  d.limitExceeded ? 'blocked_limit' : d.reason === 'permission_denied' ? 'blocked_permission' : 'blocked_unpaid';

@Injectable()
export class AiEntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    // Optional so the guard is harmless in any environment where the AI repo/logger are not bound (dev, tests,
    // no DB). An unbound gate PASSES rather than denying — a missing dependency must never lock a tenant out of
    // a feature they are paying for.
    @Optional() private readonly repo?: AiEntitlementRepo,
    @Optional() private readonly usage?: AiUsageLogger,
    // the shared EntitlementService (app.module binds it); absent → a private one over the same repo, same behaviour
    @Optional() entitlements?: EntitlementService,
  ) {
    this.entitlements = entitlements ?? new EntitlementService();
    if (repo && !this.entitlements.has(AI_PACKAGE_KIND)) this.entitlements.register(aiPackageSource(repo));
  }
  private readonly entitlements: EntitlementService;

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const packageCode =
      this.reflector.get<string>(AI_PACKAGE_KEY, ctx.getHandler()) ??
      this.reflector.get<string>(AI_PACKAGE_KEY, ctx.getClass());
    if (!packageCode) return true;                       // not an AI-gated route

    const mode = enforcementMode();
    if (mode === 'off' || !this.repo) return true;

    const req = ctx.switchToHttp().getRequest();
    const c = req?.ctx || {};
    // SUPER_ADMIN is never gated on a tenant's subscription — support and oversight must keep working on a
    // suspended or lapsed tenant, which is exactly when they are needed most.
    if (!c.tenantId || isPlatformPrincipal(c)) return true;

    let decision: AiAccessDecision;
    try {
      decision = await this.entitlements.decide<AiAccessDecision, { userId: string | null }>(AI_PACKAGE_KIND, c.tenantId, packageCode, { userId: c.userId ?? null });
    } catch {
      // The gate itself failed (DB blip). FAIL OPEN: a tenant who is paying must not lose their feature because
      // a lookup timed out. This is the opposite of the malware-scan rule, and deliberately so — there the
      // downside of a false 'clean' is a live threat; here the downside of a false deny is breaking a customer
      // who paid us.
      return true;
    }

    if (decision.allowed) {
      // Functional Decision 30: warn at 80%, warn again at 90% — on every allowed AI response, so any screen can show it.
      if (decision.usageWarning) { try { ctx.switchToHttp().getResponse()?.setHeader?.('X-AI-Usage-Warning', decision.usageWarning); } catch { /* headers are best-effort */ } }
      return true;
    }

    // Record the denial either way, so `observe` produces real numbers rather than silence.
    await this.usage?.log({
      tenantId: c.tenantId,
      userId: c.userId ?? null,
      packageCode,
      action: mode === 'observe' ? 'would_block' : 'blocked',
      modelProvider: null, modelName: null,
      inputTokens: 0, outputTokens: 0,
      usageUnit: getAiPackage(packageCode)?.usageUnit ?? 'calls',
      usageAmount: 0,                                    // a denial consumes no allowance, in either mode
      costMicroUsd: 0,
      status: blockedStatus(decision),
      errorMessage: decision.reason,
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);

    // OBSERVE: the tenant keeps working. We just now KNOW they would have been blocked.
    if (mode === 'observe') return true;

    if (decision.limitExceeded) {
      throw new HttpException(
        // Functional Decision 30: the decision's code, and what the tenant can do about it. Core POS / booking / checkout /
        // manual queue never pass through this guard, so they keep working when AI usage is exhausted.
        { ok: false, code: AI_USAGE_LIMIT_REACHED, message: accessReasonLabel(decision.reason), packageCode, remainingUsage: 0,
          options: ['upgrade_plan', 'purchase_additional_usage', 'enable_overage_billing'] },
        HttpStatus.TOO_MANY_REQUESTS,          // 429 — buy overage / wait for the period to roll
      );
    }
    throw new ForbiddenException({            // 403 — fix your subscription
      ok: false, code: 'AI_PACKAGE_REQUIRED', message: accessReasonLabel(decision.reason),
      packageCode, upgradeRequired: decision.upgradeRequired, reason: decision.reason,
    });
  }
}
