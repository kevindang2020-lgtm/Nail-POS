import { ruleDiscount } from '../engine/pricing';
// salon-promotions.dto.ts — tenant salon promotions / coupon codes. DISTINCT from the platform
// promotions module. Money is integer cents. Discount + redemption rules are pure functions so they
// are unit-testable and could later be reused at checkout without duplicating logic.

export interface SalonPromotionsContext {
  tenantId: string;
  branchId?: string;
  userId: string;
  role: string;
  permissions: string[];
}

export type SalonDiscountType = 'percent' | 'fixed';
export type SalonPromotionStatus = 'draft' | 'active' | 'paused' | 'expired' | 'archived';

export interface SalonPromotion {
  id: string;
  code: string;
  name: string;
  discountType: SalonDiscountType;
  discountPercent: number | null;
  discountCents: number | null;
  minPurchaseCents: number;
  status: SalonPromotionStatus;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: string;
}

export interface CreateSalonPromotionInput {
  code: string;
  name: string;
  discountType: SalonDiscountType;
  discountPercent?: number | null;
  discountCents?: number | null;
  minPurchaseCents?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
}

export interface SalonPromotionsSummary {
  total: number;
  active: number;
  paused: number;
  totalRedemptions: number;
  expiringSoon: number; // active promos ending within 7 days
}

export interface SalonPromotionsState { kpis: SalonPromotionsSummary; promotions: SalonPromotion[]; }

export const SALON_PROMOTION_STATUSES: SalonPromotionStatus[] = ['draft', 'active', 'paused', 'expired', 'archived'];

// Pure: the discount (integer cents) a promo applies to a subtotal, never exceeding the subtotal.
export function computeSalonDiscountCents(
  promo: Pick<SalonPromotion, 'discountType' | 'discountPercent' | 'discountCents'>,
  subtotalCents: number,
): number {
  // BUILD_PLAN Phase 5: one discount formula (engine/pricing.ts ruleDiscount) — this was the fourth copy
  return ruleDiscount({ type: promo.discountType === 'percent' ? 'percent' : 'fixed', percent: promo.discountPercent, cents: promo.discountCents }, Math.round(subtotalCents || 0));
}

// Pure: can this promo be redeemed now for this subtotal? Returns a reason when not.
export function salonPromotionRedeemable(promo: SalonPromotion, subtotalCents: number, nowIso: string): { ok: boolean; reason?: string } {
  if (promo.status !== 'active') return { ok: false, reason: 'Promotion is not active' };
  const now = new Date(nowIso).getTime();
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now) return { ok: false, reason: 'Promotion has not started yet' };
  if (promo.endsAt && new Date(promo.endsAt).getTime() < now) return { ok: false, reason: 'Promotion has expired' };
  if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) return { ok: false, reason: 'Redemption limit reached' };
  if ((subtotalCents || 0) < (promo.minPurchaseCents || 0)) return { ok: false, reason: 'Minimum purchase not met' };
  return { ok: true };
}

// Pure: validate a create request.
export function validateCreateSalonPromotion(input: CreateSalonPromotionInput): { ok: boolean; error?: string } {
  if (!input?.code || !String(input.code).trim()) return { ok: false, error: 'Code is required' };
  if (!input?.name || !String(input.name).trim()) return { ok: false, error: 'Name is required' };
  if (input.discountType === 'percent') {
    const p = Number(input.discountPercent);
    if (!(p > 0 && p <= 100)) return { ok: false, error: 'Percent discount must be between 1 and 100' };
  } else if (input.discountType === 'fixed') {
    if (!(Number(input.discountCents) > 0)) return { ok: false, error: 'Fixed discount must be greater than 0' };
  } else {
    return { ok: false, error: 'Discount type must be percent or fixed' };
  }
  if (input.minPurchaseCents != null && Number(input.minPurchaseCents) < 0) return { ok: false, error: 'Minimum purchase cannot be negative' };
  return { ok: true };
}

// Pure: portfolio summary for the management dashboard.
export function buildSalonPromotionsSummary(promos: SalonPromotion[], nowIso: string): SalonPromotionsSummary {
  const now = new Date(nowIso).getTime();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  let active = 0, paused = 0, totalRedemptions = 0, expiringSoon = 0;
  for (const p of promos) {
    totalRedemptions += Math.max(0, p.redemptionCount || 0);
    if (p.status === 'active') {
      active++;
      if (p.endsAt) { const e = new Date(p.endsAt).getTime(); if (e >= now && e - now <= weekMs) expiringSoon++; }
    } else if (p.status === 'paused') paused++;
  }
  return { total: promos.length, active, paused, totalRedemptions, expiringSoon };
}
