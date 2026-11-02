/**
 * compensation-bonus-rules.service.ts — authoring + preview for target-based bonuses (spec §17). CRUD validates each
 * rule with the shared validator. previewForTechnician gathers the technician's measurable facts (via an injected loader)
 * and evaluates the applicable rules, returning every rule with its qualified flag + values for transparent human review.
 * It RECOMMENDS — approval + payout happen later; this never writes a payment.
 */
import type { BonusPreview, PeriodBonusTech, PeriodBonusReview } from '@aipowersalon/api-contracts/tenant';
export type { BonusPreview, PeriodBonusTech, PeriodBonusReview };   // owned by packages/api-contracts (Constitution 13 §13)
import { evaluateBonuses, totalEarnedBonusCents, validateBonusRule, type BonusFacts, type BonusRule, type EarnedBonus } from './compensation-bonus';
import { buildManualAdjustment, type AdjustmentEntry } from './compensation-adjustments';
import type { BonusRulesRepo, BonusRuleCtx, BonusRuleRow } from './compensation-bonus-rules.repository';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export type BonusFactsLoader = (ctx: BonusRuleCtx, technicianId: string, fromIso: string, toIso: string) => Promise<BonusFacts>;
export type BonusAdjustmentAppender = (ctx: BonusRuleCtx, entry: AdjustmentEntry) => Promise<boolean>;
export type BonusPeriodResolver = (ctx: BonusRuleCtx, periodId: string) => Promise<{ fromIso: string; toIso: string; technicianIds: string[] } | null>;

export class BonusRulesError extends Error {
  constructor(msg: string, public status = 400) { super(msg); this.name = 'BonusRulesError'; }
}

const toRule = (r: BonusRuleRow): BonusRule => ({ id: r.id, label: r.label ?? undefined, metric: r.metric, target: r.target, amountCents: r.amountCents });


export class BonusRulesService {
  constructor(private readonly repo: BonusRulesRepo, private readonly factsLoader?: BonusFactsLoader, private readonly appendAdjustment?: BonusAdjustmentAppender, private readonly periodResolver?: BonusPeriodResolver) {}

  list(ctx: BonusRuleCtx) { return this.repo.list(ctx); }

  async create(ctx: BonusRuleCtx, body: any) {
    const rule: BonusRule = { metric: body?.metric, target: Number(body?.target), amountCents: Math.round(Number(body?.amountCents)) };
    const err = validateBonusRule(rule);
    if (err) throw new BonusRulesError(err);
    return this.repo.create(ctx, { technicianId: body?.technicianId ?? null, branchId: body?.branchId ?? null, metric: rule.metric, target: rule.target, amountCents: rule.amountCents, label: body?.label ?? null });
  }

  async archive(ctx: BonusRuleCtx, id: string) {
    const ok = await this.repo.archive(ctx, id);
    if (!ok) throw withCode(new BonusRulesError('Rule not found', 404), 'RULE_NOT_FOUND');
    return { ok: true };
  }

  async previewForTechnician(ctx: BonusRuleCtx, args: { technicianId: string; fromIso: string; toIso: string }): Promise<BonusPreview> {
    if (!args?.technicianId) throw new BonusRulesError('technicianId is required');
    const applicable = (await this.repo.list(ctx)).filter((r) => !r.technicianId || r.technicianId === args.technicianId);
    const facts = this.factsLoader ? await this.factsLoader(ctx, args.technicianId, args.fromIso, args.toIso).catch(() => ({} as BonusFacts)) : {};
    const rules = applicable.map(toRule);
    return { technicianId: args.technicianId, facts, bonuses: evaluateBonuses(rules, facts), totalEarnedCents: totalEarnedBonusCents(rules, facts) };
  }

  /**
   * Read-only bonus review for a built payroll period: previews every technician in the period and returns those with
   * qualified bonuses, so the owner can review and approve them at payroll time. Recommends only — approval is still the
   * separate explicit approveBonus action.
   */
  async reviewPeriod(ctx: BonusRuleCtx, periodId: string): Promise<PeriodBonusReview> {
    if (!periodId) throw new BonusRulesError('periodId is required');
    if (!this.periodResolver) throw withCode(new BonusRulesError('Period review is unavailable here', 503), 'FEATURE_NOT_AVAILABLE');
    const p = await this.periodResolver(ctx, periodId);
    if (!p) throw withCode(new BonusRulesError('Payroll period not found', 404), 'PAYROLL_PERIOD_NOT_FOUND');
    const technicians: PeriodBonusTech[] = [];
    let grandTotalCents = 0;
    for (const technicianId of p.technicianIds) {
      const preview = await this.previewForTechnician(ctx, { technicianId, fromIso: p.fromIso, toIso: p.toIso });
      const bonuses = preview.bonuses.filter((b) => b.qualified);
      if (bonuses.length) { technicians.push({ technicianId, bonuses, totalEarnedCents: preview.totalEarnedCents }); grandTotalCents += preview.totalEarnedCents; }
    }
    return { periodId, technicians, grandTotalCents };
  }

  /**
   * §17 approve an earned bonus into a payroll period. Records it through the existing manual-adjustment path as a
   * 'bonus' entry with the owner as approver (status 'approved'), so payroll picks it up as net adjustment on top of the
   * technician's earnings. This is the ONLY place a bonus becomes payable — always an explicit human action, never auto.
   */
  async approveBonus(ctx: BonusRuleCtx, body: { technicianId?: string; periodId?: string; amountCents?: number; label?: string }) {
    if (!this.appendAdjustment) throw withCode(new BonusRulesError('Bonus approval is unavailable here', 503), 'FEATURE_NOT_AVAILABLE');
    const amountCents = Math.round(Number(body?.amountCents));
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw withCode(new BonusRulesError('A positive bonus amount is required'), 'BONUS_AMOUNT_REQUIRED');
    const built = buildManualAdjustment({
      technicianId: body?.technicianId, periodId: body?.periodId, category: 'bonus', amountCents,
      reason: (body?.label && body.label.trim()) || 'Bonus', requestedBy: ctx.userId ?? 'owner', approvedBy: ctx.userId ?? 'owner',
    });
    if (built.errors.length || !built.entry) throw new BonusRulesError(built.errors.join(' ') || 'Invalid bonus');
    const ok = await this.appendAdjustment(ctx, built.entry);
    if (!ok) throw withCode(new BonusRulesError('Could not record the bonus', 500), 'BONUS_NOT_RECORDED');
    return { ok: true, status: built.entry.status, amountCents: built.entry.amountCents };
  }
}
