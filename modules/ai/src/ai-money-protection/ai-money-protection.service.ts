// ai-money-protection.service.ts — orchestrates deterministic detection + tenant-scoped reads. The AI model is
// NOT involved here: Layer-1 rules are pure and deterministic. Detection is read-only over authoritative tables
// and creates alerts idempotently (dedup upsert). It never mutates payments/refunds and never accuses anyone.
import type {
  MoneyProtectionContext, MoneyProtectionState, MoneyProtectionAlert,
} from './ai-money-protection.dto';
import type { MoneyProtectionRepositoryPort, AlertFilters } from './ai-money-protection.repository';
import { runDeterministicRules, previewRuleThresholds, type RuleThresholdPreview } from './ai-money-protection-rules';
import { scoreReversalRateOutliers } from './ai-money-protection-baselines';
import { runReconciliation } from './ai-money-protection-reconciliation';
import { moneyProtectionFlags, type MoneyProtectionFlags } from './ai-money-protection-flags';
import { getRuleCatalog, RULE_CATALOG } from './ai-money-protection-catalog';
import { applyRuleSettings, thresholdOverrides, validateRuleSetting, type RuleSetting } from './ai-money-protection-settings';
import type { EntitlementPort } from './ai-money-protection-entitlement';
import { mpTextCoded } from '@aipowersalon/api-contracts/tenant';

export class MoneyProtectionForbiddenError extends Error {
  constructor(msg = 'INSUFFICIENT_PERMISSION') { super(msg); this.name = 'MoneyProtectionForbiddenError'; }
}
export class MoneyProtectionValidationError extends Error {
  constructor(msg: string) { super(msg); this.name = 'MoneyProtectionValidationError'; }
}
export class MoneyProtectionDisabledError extends Error {
  constructor(msg = 'AI_MONEY_PROTECTION_DISABLED') { super(msg); this.name = 'MoneyProtectionDisabledError'; }
}

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24h window for on-demand deterministic evaluation

export class MoneyProtectionService {
  constructor(
    private readonly repo: MoneyProtectionRepositoryPort,
    private readonly entitlement?: EntitlementPort,
    private readonly flags: MoneyProtectionFlags = moneyProtectionFlags(),
  ) {}

  private need(ctx: MoneyProtectionContext, perm: string) {
    if (!ctx || !ctx.tenantId) throw new MoneyProtectionValidationError('Missing tenant context');
    if (!(ctx.permissions || []).includes(perm)) throw new MoneyProtectionForbiddenError();
  }

  // Plans/Feature-Limits gate: the module must be enabled AND the tenant entitled (spec §83/§85).
  private async assertEnabled(ctx: MoneyProtectionContext) {
    if (!this.flags.enabled) throw new MoneyProtectionDisabledError();
    if (this.entitlement && !(await this.entitlement.hasMoneyProtection(ctx.tenantId))) {
      throw new MoneyProtectionDisabledError();
    }
  }

  async getState(ctx: MoneyProtectionContext): Promise<MoneyProtectionState> {
    this.need(ctx, 'ai_money_protection.view');
    await this.assertEnabled(ctx);
    return this.repo.getState(ctx);
  }

  // The detection catalog (spec §33/§97): every rule + its category/severity/layer/mode/thresholds + whether it is
  // currently enabled by feature flags. Read-only metadata; view-gated.
  async getRules(ctx: MoneyProtectionContext) {
    this.need(ctx, 'ai_money_protection.view');
    await this.assertEnabled(ctx);
    return getRuleCatalog();
  }

  // Tenant rule settings (spec §33/§69/§84): enable/disable, severity override, bounded threshold overrides.
  async getSettings(ctx: MoneyProtectionContext) {
    this.need(ctx, 'ai_money_protection.view');
    await this.assertEnabled(ctx);
    return this.repo.getRuleSettings(ctx);
  }
  async updateSetting(ctx: MoneyProtectionContext, ruleId: string, input: any): Promise<RuleSetting> {
    this.need(ctx, 'ai_money_protection.manage_settings');
    await this.assertEnabled(ctx);
    const known = new Set(RULE_CATALOG.map((r) => r.id));
    const v = validateRuleSetting(ruleId, input, known);
    if (!v.ok || !v.value) throw new MoneyProtectionValidationError(v.errors.join('; ') || 'Invalid setting');
    return this.repo.upsertRuleSetting(ctx, v.value, ctx.userId);
  }

  // Safe Rule Preview (Money Protection 5 · 07): what one rule would have matched over the salon's last `days` of
  // authoritative activity with the current vs the proposed thresholds. Read-only — no alert, no setting, no event.
  async previewRule(ctx: MoneyProtectionContext, ruleId: string, thresholds: unknown, days = 30): Promise<RuleThresholdPreview & { windowDays: number; paymentsEvaluated: number; attemptsEvaluated: number }> {
    this.need(ctx, 'ai_money_protection.manage_settings');
    await this.assertEnabled(ctx);
    const known = new Set(RULE_CATALOG.map((r) => r.id));
    const v = validateRuleSetting(ruleId, { thresholds: thresholds ?? {} }, known);
    if (!v.ok || !v.value) throw new MoneyProtectionValidationError(v.errors.join('; ') || 'Invalid setting');
    const settings = await this.repo.getRuleSettings(ctx);
    const activity = await this.repo.loadActivity(ctx, Date.now() - days * 24 * 60 * 60 * 1000);
    const p = previewRuleThresholds(activity, ruleId, thresholdOverrides(settings), v.value.thresholds);
    return { ...p, windowDays: days, paymentsEvaluated: activity.payments.length, attemptsEvaluated: activity.attempts.length };
  }

  async listAlerts(ctx: MoneyProtectionContext, f: AlertFilters): Promise<{ items: MoneyProtectionAlert[]; nextCursor: string | null }> {
    this.need(ctx, 'ai_money_protection.view_alerts');
    await this.assertEnabled(ctx);
    const page = await this.repo.listAlerts(ctx, { ...f, limit: Math.min(100, Math.max(1, f.limit ?? 50)) });
    // Vietnamese POS §21: the evidence's fixed English re-coded (code + vars) at read time — stored alerts too
    return { ...page, items: page.items.map((a) => ({ ...a, evidenceCoded: {
      summary: mpTextCoded(a.evidence?.summary),
      recommendedReview: (a.evidence?.recommendedReview ?? []).map(mpTextCoded),
      alternativeExplanations: (a.evidence?.alternativeExplanations ?? []).map(mpTextCoded),
    } })) };
  }

  // Deterministic Layer-1 evaluation over the tenant's recent authoritative activity. Idempotent: re-running the
  // same window bumps existing alerts rather than duplicating them. Returns a small summary.
  async evaluateDeterministic(ctx: MoneyProtectionContext, sinceMs = Date.now() - DEFAULT_LOOKBACK_MS): Promise<{ evaluated: number; created: number; updated: number }> {
    this.need(ctx, 'ai_money_protection.manage_rules');
    await this.assertEnabled(ctx);
    const settings = await this.repo.getRuleSettings(ctx);
    const { payments, refunds, tickets, attempts } = await this.repo.loadActivity(ctx, sinceMs);
    const raw = [
      ...(this.flags.deterministicRules ? runDeterministicRules(payments, refunds, tickets, attempts, thresholdOverrides(settings)) : []),
      ...(this.flags.baselines ? scoreReversalRateOutliers(payments, refunds) : []), // Layer 2: fairness-gated, advisory
    ];
    const candidates = applyRuleSettings(raw, settings); // tenant enable/disable + severity overrides
    let created = 0, updated = 0;
    for (const c of candidates) {
      // window stamps the day so dedup is stable per evaluation day
      const window = new Date().toISOString().slice(0, 10);
      const r = await this.repo.upsertAlert(ctx, { ...c, evaluationWindow: window });
      if (r.created) created++; else updated++;
    }
    return { evaluated: candidates.length, created, updated };
  }

  // Batch reconciliation over authoritative domain data (membership/gift-card/cash). Runs on the reconciliation
  // worker per tenant; idempotent (same window dedups). Heavy work stays out of interactive checkout requests.
  async evaluateReconciliation(ctx: MoneyProtectionContext, sinceMs = Date.now() - DEFAULT_LOOKBACK_MS): Promise<{ evaluated: number; created: number; updated: number }> {
    this.need(ctx, 'ai_money_protection.manage_rules');
    await this.assertEnabled(ctx);
    const data = this.flags.reconciliation ? await this.repo.loadReconciliationData(ctx, sinceMs) : { membershipPayments: [], giftCards: [], giftCardTxns: [], cashSessions: [] };
    const candidates = applyRuleSettings(runReconciliation(data), await this.repo.getRuleSettings(ctx));
    let created = 0, updated = 0;
    const window = new Date().toISOString().slice(0, 10);
    for (const c of candidates) {
      const r = await this.repo.upsertAlert(ctx, { ...c, evaluationWindow: window });
      if (r.created) created++; else updated++;
    }
    return { evaluated: candidates.length, created, updated };
  }

  // Super-Admin platform overview — cross-tenant COUNTS only (no tenant identifiers or private detail). Gated by a
  // super-admin permission; feeds the Super-Admin AI Usage / Live Operations surfaces (spec §76/§78).
  async getPlatformOverview(ctx: MoneyProtectionContext) {
    if (!(ctx?.permissions || []).includes('super_admin.tenants.view')) throw new MoneyProtectionForbiddenError();
    return this.repo.platformAggregate();
  }
}
