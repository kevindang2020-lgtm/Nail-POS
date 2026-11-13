// review-request-price.ts — Reviews Reputation 07 (extras round 11): the PLATFORM per-message price of a review-request text,
// as a mechanism. BLANK BY DEFAULT: with no value the review-request dry run keeps saying the cost is "not available" exactly
// as before. When a Super Admin sets it (System Settings → Global Defaults), the dry run shows an ESTIMATE: integer cents ×
// the recipients who would be texted. One rule for the settings screen (validation) and the reader.
export const REVIEW_REQUEST_PRICE_SETTING = 'sms.review_request_price_cents';
/** hard safety ceiling for one text (cents) — a typo guard, not a price */
export const REVIEW_REQUEST_PRICE_CEILING_CENTS = 1000;
/** the stored setting → whole cents, 'blank' (unset / null / empty), or 'invalid' (anything else — never guessed or rounded) */
export function parseReviewRequestPriceCents(v: unknown): number | 'blank' | 'invalid' {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return 'blank';
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= REVIEW_REQUEST_PRICE_CEILING_CENTS ? n : 'invalid';
}
