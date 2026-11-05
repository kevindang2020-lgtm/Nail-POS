// salon-promotions.service.ts — tenant salon promotions: manage (create/status) + redeem (validate + count).
import {
  buildSalonPromotionsSummary, computeSalonDiscountCents, salonPromotionRedeemable, validateCreateSalonPromotion, SALON_PROMOTION_STATUSES,
  type SalonPromotionsContext, type SalonPromotionsState, type CreateSalonPromotionInput, type SalonPromotionStatus, type SalonPromotion,
} from './salon-promotions.dto';
import type { SalonPromotionsRepositoryPort } from './salon-promotions.repository';
import { validateSharedCode } from '../engine/coupons';

export class SalonPromotionForbiddenError extends Error {}
export class SalonPromotionValidationError extends Error {}

export interface SalonRedeemResult { ok: boolean; reason?: string; discountCents?: number; promotion?: SalonPromotion; }

export class SalonPromotionsService {
  constructor(private readonly repo: SalonPromotionsRepositoryPort) {}

  private auth(ctx: SalonPromotionsContext) { if (!ctx?.userId || !ctx?.tenantId) throw new SalonPromotionForbiddenError('Not authenticated'); }

  async getState(ctx: SalonPromotionsContext): Promise<SalonPromotionsState> {
    this.auth(ctx);
    const promotions = await this.repo.list(ctx);
    return { kpis: buildSalonPromotionsSummary(promotions, new Date().toISOString()), promotions };
  }

  async create(ctx: SalonPromotionsContext, input: CreateSalonPromotionInput): Promise<SalonPromotion> {
    this.auth(ctx);
    const v = validateCreateSalonPromotion(input);
    if (!v.ok) throw new SalonPromotionValidationError(v.error || 'Invalid promotion');
    const bad = validateSharedCode(input.code);
    if (bad) throw new SalonPromotionValidationError(bad);
    const existing = await this.repo.findByCode(ctx, input.code);
    if (existing) throw new SalonPromotionValidationError('A promotion with that code already exists');
    return this.repo.create(ctx, input);
  }

  async setStatus(ctx: SalonPromotionsContext, id: string, status: string): Promise<SalonPromotion> {
    this.auth(ctx);
    if (!SALON_PROMOTION_STATUSES.includes(status as SalonPromotionStatus)) throw new SalonPromotionValidationError('Invalid status');
    const row = await this.repo.setStatus(ctx, id, status as SalonPromotionStatus);
    if (!row) throw new SalonPromotionValidationError('Promotion not found');
    return row;
  }

  /**
   * CHECK a code against a subtotal: would it apply, and for how much? BUILD_PLAN Phase 5: this no longer counts a
   * redemption (bug 4 — it counted one at every check, and bug 10 — eight registers at once all passed a cap of one).
   * A coupon is used only when it is applied to a TICKET (checkout → deals engine: one use, under the deal's lock) and
   * redeemed when that ticket is paid.
   */
  async redeem(ctx: SalonPromotionsContext, code: string, subtotalCents: number): Promise<SalonRedeemResult> {
    this.auth(ctx);
    const promo = await this.repo.findByCode(ctx, code);
    if (!promo) return { ok: false, reason: 'No promotion found for that code' };
    const check = salonPromotionRedeemable(promo, subtotalCents, new Date().toISOString());
    if (!check.ok) return { ok: false, reason: check.reason };
    return { ok: true, discountCents: computeSalonDiscountCents(promo, subtotalCents), promotion: promo };
  }
}
