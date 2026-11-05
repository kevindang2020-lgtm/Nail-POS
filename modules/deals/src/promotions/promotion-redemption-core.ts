// Server-authoritative promotion logic. No DB/Nest deps. This is the ONLY place a discount amount is computed — the
// client never supplies one. All money is integer cents. Pure + fully testable so the redemption path is trustworthy.

export const PROMOTION_TYPES = ['percentage', 'fixed_amount', 'buy_x_get_y', 'bundle', 'free_service', 'free_product', 'package', 'new_client', 'platform_sponsored'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export interface DiscountInput { promotionType: string; discountValue: number; maxDiscountCents?: number | null; minPurchaseCents?: number; eligibleSubtotalCents: number }
export type DiscountResult = { ok: true; discountCents: number; finalSubtotalCents: number } | { ok: false; reason: string };

export function computeDiscountCents(input: DiscountInput): DiscountResult {
  const subtotal = Math.max(0, Math.round(input.eligibleSubtotalCents || 0));
  const min = Math.max(0, Math.round(input.minPurchaseCents || 0));
  if (subtotal < min) return { ok: false, reason: `minimum purchase of ${min} cents not met` };
  const type = String(input.promotionType || '').toLowerCase();
  let discount = 0;
  if (type === 'percentage') {
    const pct = Math.max(0, Number(input.discountValue) || 0);
    discount = Math.floor((subtotal * pct) / 100);
    if (input.maxDiscountCents != null && input.maxDiscountCents >= 0) discount = Math.min(discount, Math.round(input.maxDiscountCents));
  } else if (type === 'fixed_amount' || type === 'new_client' || type === 'bundle' || type === 'package' || type === 'free_service' || type === 'free_product') {
    discount = Math.max(0, Math.round(Number(input.discountValue) || 0));
  } else {
    return { ok: false, reason: `unsupported promotion type "${type}"` };
  }
  discount = Math.min(discount, subtotal);
  return { ok: true, discountCents: discount, finalSubtotalCents: subtotal - discount };
}

export interface StateInput { status: string; startAt?: string | null; endAt?: string | null; nowMs: number; approvalRequired?: boolean; approvalStatus?: string }
export type StateResult = { ok: true } | { ok: false; reason: string };

export function validatePromotionState(s: StateInput): StateResult {
  const status = String(s.status || '').toLowerCase();
  if (status === 'disabled') return { ok: false, reason: 'promotion is disabled' };
  if (status !== 'active' && status !== 'approved' && status !== 'scheduled') return { ok: false, reason: `promotion status "${status}" is not redeemable` };
  if (s.approvalRequired && s.approvalStatus !== 'approved') return { ok: false, reason: 'promotion requires approval before redemption' };
  const start = s.startAt ? Date.parse(s.startAt) : NaN;
  const end = s.endAt ? Date.parse(s.endAt) : NaN;
  if (!Number.isNaN(start) && s.nowMs < start) return { ok: false, reason: 'promotion has not started' };
  if (!Number.isNaN(end) && s.nowMs > end) return { ok: false, reason: 'promotion has ended' };
  return { ok: true };
}

export interface LimitCounts { customerCount: number; branchCount: number; tenantCount: number; globalCount: number }
export interface LimitConfig { customerLimit: number; branchLimit: number; tenantLimit: number; globalLimit: number }
export type LimitResult = { ok: true } | { ok: false; reason: string };

export function checkLimits(counts: LimitCounts, cfg: LimitConfig): LimitResult {
  const chk = (limit: number, count: number, scope: string): LimitResult => (limit > 0 && count >= limit ? { ok: false, reason: `${scope} redemption limit reached` } : { ok: true });
  for (const r of [chk(cfg.customerLimit, counts.customerCount, 'customer'), chk(cfg.branchLimit, counts.branchCount, 'branch'), chk(cfg.tenantLimit, counts.tenantCount, 'tenant'), chk(cfg.globalLimit, counts.globalCount, 'platform')]) {
    if (!r.ok) return r;
  }
  return { ok: true };
}

export const MIN_REVERSAL_REASON = 4;
export function validateReversalReason(reason: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < MIN_REVERSAL_REASON) return { ok: false, error: `reversal reason is required (min ${MIN_REVERSAL_REASON} chars)` };
  return { ok: true, reason: r };
}
