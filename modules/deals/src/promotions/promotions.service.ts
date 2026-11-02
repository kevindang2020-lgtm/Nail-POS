// Promotion redemption engine — server-authoritative validate / redeem / reverse. The discount is always computed here
// (never trusted from the client). Redemption is idempotent (same key → same row) and limit-enforced. Reversal
// preserves the original row. Tenant scope is derived from the caller context, never from the request body.
import { computeDiscountCents, validatePromotionState, checkLimits, validateReversalReason } from './promotion-redemption-core';
import type { PromotionsRepositoryPort } from './promotions.repository';

export class PromotionError extends Error { constructor(public code: 'invalid' | 'not_found' | 'ineligible', message: string) { super(message); } }

export interface RedeemCtx { tenantId: string; branchId?: string | null }
export interface ValidateInput { promotionId: string; customerId?: string | null; branchId?: string | null; eligibleSubtotalCents: number }
export interface RedeemInput extends ValidateInput { ticketId?: string | null; checkoutId?: string | null; idempotencyKey: string }

export class PromotionsService {
  constructor(private readonly repo: PromotionsRepositoryPort) {}

  private async evaluate(ctx: RedeemCtx, input: ValidateInput) {
    const promo = await this.repo.getPromotion(String(input.promotionId || ''), ctx.tenantId);
    if (!promo) throw new PromotionError('not_found', 'Promotion not found for this tenant');
    const state = validatePromotionState({ status: promo.status, startAt: promo.startAt, endAt: promo.endAt, nowMs: Date.now(), approvalRequired: promo.approvalRequired, approvalStatus: promo.approvalStatus });
    if (!state.ok) throw new PromotionError('ineligible', state.reason);
    const disc = computeDiscountCents({ promotionType: promo.promotionType, discountValue: promo.discountValue, maxDiscountCents: promo.maxDiscountCents, minPurchaseCents: promo.minPurchaseCents, eligibleSubtotalCents: input.eligibleSubtotalCents });
    if (!disc.ok) throw new PromotionError('ineligible', disc.reason);
    const branchId = input.branchId ?? ctx.branchId ?? null;
    const counts = await this.repo.countRedemptions(promo.id, { customerId: input.customerId ?? null, branchId, tenantId: ctx.tenantId });
    const limits = checkLimits(counts, { customerLimit: promo.customerLimit, branchLimit: promo.branchLimit, tenantLimit: promo.tenantLimit, globalLimit: promo.globalLimit });
    if (!limits.ok) throw new PromotionError('ineligible', limits.reason);
    return { promo, disc, branchId };
  }

  async validate(ctx: RedeemCtx, input: ValidateInput) {
    const { disc } = await this.evaluate(ctx, input);
    return { eligible: true, discountCents: disc.discountCents, finalSubtotalCents: disc.finalSubtotalCents };
  }

  async redeem(ctx: RedeemCtx, input: RedeemInput) {
    const key = String(input.idempotencyKey || '').trim();
    if (!key) throw new PromotionError('invalid', 'idempotencyKey is required');
    // Idempotent short-circuit: a retry with the same key returns the original redemption, never a new one.
    const prior = await this.repo.findRedemptionByIdem(String(input.promotionId || ''), key, ctx.tenantId);
    if (prior) return { redemption: prior, idempotentReplay: true };
    const { promo, disc, branchId } = await this.evaluate(ctx, input);
    let redemption;
    try {
    redemption = await this.repo.insertRedemption({
      promotionId: input.promotionId, tenantId: ctx.tenantId, branchId, customerId: input.customerId ?? null, ticketId: input.ticketId ?? null, checkoutId: input.checkoutId ?? null,
      eligibleSubtotalCents: Math.max(0, Math.round(input.eligibleSubtotalCents || 0)), discountCents: disc.discountCents, finalSubtotalCents: disc.finalSubtotalCents, currency: 'USD', idempotencyKey: key,
    }, { customerLimit: promo.customerLimit, tenantLimit: promo.tenantLimit });   // Phase 5: re-checked under the deal's lock
    } catch (e: any) { if (/limit reached/.test(String(e?.message))) throw new PromotionError('ineligible', 'redemption limit reached'); throw e; }
    return { redemption, idempotentReplay: false };
  }

  async reverse(ctx: RedeemCtx, redemptionId: string, reason: unknown) {
    const v = validateReversalReason(reason);
    if (!v.ok) throw new PromotionError('invalid', v.error);
    const existing = await this.repo.getRedemption(String(redemptionId || ''), ctx.tenantId);
    if (!existing) throw new PromotionError('not_found', 'Redemption not found for this tenant');
    if (existing.status === 'reversed') return { redemption: existing, alreadyReversed: true };
    const updated = await this.repo.reverseRedemption(existing.id, v.reason, ctx.tenantId);
    return { redemption: updated!, alreadyReversed: false };
  }
}
