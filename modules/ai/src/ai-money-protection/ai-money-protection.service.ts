// ai-money-protection.service.ts — orchestrates deterministic detection + tenant-scoped reads. The AI model is
// NOT involved here: Layer-1 rules are pure and deterministic. Detection is read-only over authoritative tables
// and creates alerts idempotently (dedup upsert). It never mutates payments/refunds and never accuses anyone.
import type {
  MoneyProtectionContext, MoneyProtectionState, MoneyProtectionAlert,
} from './ai-money-protection.dto';
import type { MoneyProtectionRepositoryPort, AlertFilters } from './ai-money-protection.repository';
import { runDeterministicRules } from './ai-money-protection-rules';
import { scoreReversalRateOutliers } from './ai-money-protection-baselines';
import { runReconciliation } from './ai-money-protection-reconciliation';
import { moneyProtectionFlags, type MoneyProtectionFlags } from './ai-money-protection-flags';
import { getRuleCatalog, RULE_CATALOG } from './ai-money-protection-catalog';
import { applyRuleSettings, thresholdOverrides, validateRuleSetting, previewThresholdDiff, PREVIEW_SIMULATED_RULES, type RuleSetting, type ThresholdPreviewDiff } from './ai-money-protection-settings';
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

const PREVIEW_DAYS = 30;   // Threshold Change Preview: how far back the dry run looks
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

  /** Threshold Change Preview (Money Protection Rules 09): a DRY RUN of one rule's proposed thresholds against the same
   *  recent activity the detector reads (last `days` days). Nothing is saved and no alert is created or touched. */
  async previewThresholds(ctx: MoneyProtectionContext, ruleId: string, proposed: unknown, days = PREVIEW_DAYS): Promise<
    { ruleId: string; dryRun: true; supported: false; reason: 'threshold_not_read_by_detector'; windowDays: number } |
    ({ ruleId: string; dryRun: true; supported: true; windowDays: number; currentThresholds: Record<string, number>; proposedThresholds: Record<string, number> } & ThresholdPreviewDiff)> {
    this.need(ctx, 'ai_money_protection.view');
    await this.assertEnabled(ctx);
    const known = new Set(RULE_CATALOG.map((r) => r.id));
    const v = validateRuleSetting(ruleId, { thresholds: proposed ?? {} }, known);
    if (!v.ok || !v.value) throw new MoneyProtectionValidationError(v.errors.join('; ') || 'Invalid setting');
    if (!PREVIEW_SIMULATED_RULES.includes(ruleId)) return { ruleId, dryRun: true, supported: false, reason: 'threshold_not_read_by_detector', windowDays: days };
    const settings = await this.repo.getRuleSettings(ctx);
    const def = RULE_CATALOG.find((r) => r.id === ruleId);
    const numeric = (o: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, x]) => typeof x === 'number')) as Record<string, number>;
    const currentThresholds = { ...numeric(def?.defaultThresholds), ...(settings[ruleId]?.thresholds ?? {}) };
    const proposedThresholds = { ...currentThresholds, ...v.value.thresholds };
    const { payments, refunds, tickets, attempts } = await this.repo.loadActivity(ctx, Date.now() - days * 86_400_000);
    // the rule is previewed as if it were on (the question is what the THRESHOLD does); a severity override applies to both runs
    const forced = { ...settings, [ruleId]: { ruleId, enabled: true, severityOverride: settings[ruleId]?.severityOverride ?? null, thresholds: currentThresholds } };
    const base = thresholdOverrides(forced);
    const current = applyRuleSettings(runDeterministicRules(payments, refunds, tickets, attempts, base), forced);
    const next = applyRuleSettings(runDeterministicRules(payments, refunds, tickets, attempts, { ...base, [ruleId]: proposedThresholds }), forced);
    return { ruleId, dryRun: true, supported: true, windowDays: days, currentThresholds, proposedThresholds, ...previewThresholdDiff(ruleId, current, next) };
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
