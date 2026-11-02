// coupon-verdict.ts — Coupons & Promotions guide §12: the read-only "Check Coupon / Promotion" verdict. It translates the
// SAME reasons Checkout's engine produces (evaluateEligibility + priceTicket, via DealsCheckoutService.check) into the
// guide's structured result codes with action guidance. It never decides eligibility itself — an empty reason list from
// the engine is the only way to ELIGIBLE — so the checker and Checkout cannot disagree.
import type { Reason } from './eligibility';

export const VERDICT_CODES = ['ELIGIBLE', 'NOT_YET_ACTIVE', 'EXPIRED', 'PAUSED', 'WRONG_BRANCH', 'INELIGIBLE_SERVICE', 'MIN_SPEND', 'LIMIT_REACHED',
  'ALREADY_USED', 'REQUIRES_APPROVAL', 'CONFIG_MISSING', 'NOT_COMBINABLE', 'NEEDS_CUSTOMER', 'NEEDS_CODE', 'CUSTOMER_INELIGIBLE', 'NOT_AVAILABLE'] as const;
export type VerdictCode = (typeof VERDICT_CODES)[number];

/** engine reason code → guide code. Anything unmapped is NOT_AVAILABLE (never silently ELIGIBLE). */
const MAP: Record<string, VerdictCode> = {
  not_started: 'NOT_YET_ACTIVE', service_before_start: 'NOT_YET_ACTIVE',
  ended: 'EXPIRED', service_after_end: 'EXPIRED',
  wrong_branch: 'WRONG_BRANCH', rule_branch: 'WRONG_BRANCH',
  no_eligible_service: 'INELIGIBLE_SERVICE', rule_service: 'INELIGIBLE_SERVICE', rule_technician: 'INELIGIBLE_SERVICE',
  min_spend: 'MIN_SPEND', rule_min_spend: 'MIN_SPEND',
  sold_out: 'LIMIT_REACHED', budget_exhausted: 'LIMIT_REACHED',
  per_customer_limit: 'ALREADY_USED', code_used: 'ALREADY_USED',
  customer_required: 'NEEDS_CUSTOMER', code_required: 'NEEDS_CODE',
  new_customers_only: 'CUSTOMER_INELIGIBLE', existing_customers_only: 'CUSTOMER_INELIGIBLE', members_only: 'CUSTOMER_INELIGIBLE',
  rule_min_visits: 'CUSTOMER_INELIGIBLE', rule_max_visits: 'CUSTOMER_INELIGIBLE', rule_birthday: 'CUSTOMER_INELIGIBLE', rule_member: 'CUSTOMER_INELIGIBLE',
  rule_not_member: 'CUSTOMER_INELIGIBLE', rule_lapsed: 'CUSTOMER_INELIGIBLE',
  engine_off: 'PAUSED', tenant_disabled: 'PAUSED', tech_frozen: 'PAUSED',
  not_stackable: 'NOT_COMBINABLE', same_stack_group: 'NOT_COMBINABLE', not_with_membership: 'NOT_COMBINABLE', not_with_loyalty: 'NOT_COMBINABLE',
  price_floor: 'NOT_COMBINABLE', not_best: 'NOT_COMBINABLE', too_many: 'NOT_COMBINABLE',
  config_missing: 'CONFIG_MISSING',
};

/** what the person at the desk can do about it (English; the POS renders its own EN/VI text from the code) */
export const VERDICT_ACTION: Record<VerdictCode, string> = {
  ELIGIBLE: 'It can be applied at Checkout.',
  NOT_YET_ACTIVE: 'Wait for the start date, or ask a manager to change it.',
  EXPIRED: 'It has ended; a manager can extend the end date if the salon agrees.',
  PAUSED: 'A manager has paused it (or offers are paused for the salon).',
  WRONG_BRANCH: 'Use it at the location it was made for.',
  INELIGIBLE_SERVICE: 'Add an eligible service to the ticket.',
  MIN_SPEND: 'The ticket must reach the minimum spend first.',
  LIMIT_REACHED: 'Its total limit or budget is used up.',
  ALREADY_USED: 'This customer (or this code) has already used it the allowed number of times.',
  REQUIRES_APPROVAL: 'It is a draft or waiting for approval — an owner/manager must activate it.',
  CONFIG_MISSING: 'It has no discount value or no code set up — a manager must finish it.',
  NOT_COMBINABLE: 'It cannot be combined with the offers already on this ticket under the salon\'s stacking rules.',
  NEEDS_CUSTOMER: 'Choose the customer first.',
  NEEDS_CODE: 'Enter the coupon code.',
  CUSTOMER_INELIGIBLE: 'This customer does not meet who it is for.',
  NOT_AVAILABLE: 'It is not available.',
};

export interface VerdictReason { code: VerdictCode; engineCode: string; message: string; params?: Reason['params'] }
export interface CouponVerdict { verdict: VerdictCode; eligible: boolean; reasons: VerdictReason[]; action: string }

/** Deal facts the engine does not see as "reasons" but that block application anyway. */
export function configReasons(deal: { status: string; discountType?: string | null; discountPercent?: number | null; discountCents?: number | null; requiresCode?: boolean; codes?: number }): Reason[] {
  const out: Reason[] = [];
  const pct = deal.discountType === 'percent';
  if (pct ? !(Number(deal.discountPercent) > 0) : !(Number(deal.discountCents) > 0) && deal.discountType !== 'fixed_price') out.push({ code: 'config_missing', message: 'No discount value is set.' });
  if (deal.requiresCode && deal.codes === 0) out.push({ code: 'config_missing', message: 'No code has been created.' });
  return out;
}

/** status before reasons: a draft / pending / paused / ended record says so first (the engine's not_active is generic) */
function statusCode(status: string): VerdictCode | null {
  if (status === 'draft' || status === 'pending_approval' || status === 'approved') return 'REQUIRES_APPROVAL';
  if (status === 'paused') return 'PAUSED';
  if (status === 'expired') return 'EXPIRED';
  if (status === 'sold_out') return 'LIMIT_REACHED';
  if (status === 'scheduled') return 'NOT_YET_ACTIVE';
  if (status === 'canceled' || status === 'archived' || status === 'rejected') return 'NOT_AVAILABLE';
  return null;
}

export function couponVerdict(status: string, reasons: Reason[]): CouponVerdict {
  const out: VerdictReason[] = [];
  for (const r of reasons) {
    const code: VerdictCode = r.code === 'not_active' ? (statusCode(String(r.params?.status ?? status)) ?? 'NOT_AVAILABLE') : r.code === 'suspended' ? 'PAUSED' : (MAP[r.code] ?? 'NOT_AVAILABLE');
    out.push(r.params ? { code, engineCode: r.code, message: r.message, params: r.params } : { code, engineCode: r.code, message: r.message });
  }
  const first = out[0]?.code ?? 'ELIGIBLE';
  return { verdict: first, eligible: out.length === 0, reasons: out, action: VERDICT_ACTION[first] };
}
