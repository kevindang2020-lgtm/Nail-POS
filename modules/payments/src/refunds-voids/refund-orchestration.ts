// refund-orchestration.ts — pure logic for routing and splitting refunds.
// Developer Functional Decisions 19 & 20:
// 19. Differentiate voids from refunds. Default refunds return to the original payment method.
// 20. Refunds for Split Payments. Calculate valid partial-refund allocations automatically across original tenders.

export interface OriginalTender {
  paymentId: string;
  method: 'cash' | 'card' | 'gift_card' | string;
  amountCents: number;
  /** Amount already refunded across prior partial refunds */
  refundedCents: number;
  /** Is the payment still uncaptured (voidable) or fully captured (requires a refund)? */
  captured: boolean;
}

export interface RefundAllocation {
  paymentId: string;
  method: string;
  amountToRefundCents: number;
  action: 'void' | 'refund';
}

/**
 * Functional Decision 20 — allocate a refund across the ticket's original tenders, PROPORTIONALLY to what each tender
 * can still return. The decision's own example: $60 card + $40 cash, refund $50 → $30 card + $20 cash.
 *
 * Corrected Oct 1 2026: the first version (merged from the developer's tree, never called) filled tenders in a fixed
 * priority order (card → cash → gift card), which would have put the whole $50 back on the card — contradicting the
 * decision. Rules now:
 *   1. Each tender's share is proportional to its REMAINING refundable amount (amount − already refunded), so repeated
 *      partial refunds keep every tender inside its own cap.
 *   2. Whole cents; the leftover cents go to the largest fractional remainders (ties: the larger tender), so the
 *      shares always sum exactly to the refund.
 *   3. Never more than a tender's remaining amount; a refund larger than the ticket's total remaining is refused.
 *   4. 'void' for an uncaptured tender, 'refund' for a captured one (Decision 19).
 */
export function calculateRefundAllocations(totalRefundCents: number, tenders: OriginalTender[]): RefundAllocation[] {
  const total = Math.round(totalRefundCents);
  if (!Number.isFinite(total) || total <= 0) return [];
  const open = tenders
    .map((t) => ({ ...t, availableCents: Math.max(0, Math.round(t.amountCents) - Math.round(t.refundedCents)) }))
    .filter((t) => t.availableCents > 0);
  const pool = open.reduce((n, t) => n + t.availableCents, 0);
  if (total > pool) throw new Error('Total refund exceeds the available refundable balance of the original tenders.');
  const shares = open.map((t) => {
    const exact = (total * t.availableCents) / pool;
    return { t, cents: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let leftover = total - shares.reduce((n, s) => n + s.cents, 0);
  for (const s of [...shares].sort((a, b) => b.frac - a.frac || b.t.availableCents - a.t.availableCents)) {
    if (leftover <= 0) break;
    if (s.cents < s.t.availableCents) { s.cents++; leftover--; }
  }
  return shares.filter((s) => s.cents > 0).map((s) => ({
    paymentId: s.t.paymentId, method: s.t.method, amountToRefundCents: s.cents, action: (s.t.captured ? 'refund' : 'void') as 'void' | 'refund',
  }));
}
