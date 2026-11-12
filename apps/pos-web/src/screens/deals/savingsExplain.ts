// Automatic Savings Explanation (Extras backlog · Discounts Management 09): eligible subtotal, the rule's calculation,
// the cap / subtotal limit, and the saving as separate lines. Mirrors the server's pure math
// (modules/deals/src/deals/deals-checkout-core.ts: percent → Math.round(sub × pct / 100); fixed → the amount; never more
// than the subtotal) plus the coupon's max-discount cap. The RECORDED saving is always the figure shown as the total —
// when it differs from today's rule (terms changed, stacked, reversed) the explainer says so instead of re-deriving it.
export type SavingsRule = { discountType: string; discountPercent?: number | null; discountCents?: number | null; maxDiscountCents?: number | null };
export type SavingsLines = {
  eligible: number;
  rule: number;                 // rule applied to the eligible subtotal, before any cap
  cap: number | null;           // amount removed by the cap / subtotal limit (null = nothing removed)
  capKind: 'cap' | 'subtotal' | null;
  expected: number;             // what today's rule gives
  recorded: number;             // what the ticket actually saved
  matches: boolean;
};

export function savingsExplain(rule: SavingsRule, eligibleSubtotalCents: number | null | undefined, recordedCents: number): SavingsLines | null {
  if (eligibleSubtotalCents == null) return null;              // no eligible subtotal on record → nothing to explain
  const sub = Math.max(0, Math.floor(eligibleSubtotalCents));
  const raw = rule.discountType === 'percent' ? Math.round(sub * Math.min(100, Math.max(0, rule.discountPercent ?? 0)) / 100) : Math.max(0, Math.floor(rule.discountCents ?? 0));
  const capAt = rule.maxDiscountCents != null && rule.maxDiscountCents > 0 ? Math.min(rule.maxDiscountCents, sub) : sub;
  const expected = Math.min(raw, capAt);
  const removed = raw - expected;
  const capKind = removed > 0 ? (rule.maxDiscountCents != null && rule.maxDiscountCents > 0 && rule.maxDiscountCents < sub ? 'cap' : 'subtotal') : null;
  return { eligible: sub, rule: raw, cap: removed > 0 ? removed : null, capKind, expected, recorded: recordedCents, matches: expected === recordedCents };
}
