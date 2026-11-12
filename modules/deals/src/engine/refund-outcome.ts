// refund-outcome.ts — the ONE rule for what a refund does to a deal / coupon application (used by the ledger's
// reverseForTicket and by the read-only Refund Impact Preview, Extras · Discounts 11). Pure; integer cents.
//   • unpaid ticket ('applied'): a whole-ticket void releases it; a line refund leaves it alone
//   • every discounted line refunded (or the whole ticket): reversed — its place, budget and code use come back
//   • only some discounted lines refunded: partially_reversed — the share on those lines; the place stays used
import type { LineAllocation } from './pricing';
export type RefundOutcomeKind = 'release' | 'keep' | 'reverse' | 'partial' | 'none';
export interface RefundOutcome { kind: RefundOutcomeKind; shareCents: number; nextReversedCents: number; placeReturned: boolean }

export function refundOutcome(r: { status: string; amount_discounted_cents: unknown; reversed_cents: unknown; line_allocations: unknown }, lineIds: string[] | null): RefundOutcome {
  const alloc: LineAllocation[] = Array.isArray(r.line_allocations) ? r.line_allocations as LineAllocation[] : (typeof r.line_allocations === 'string' ? JSON.parse(r.line_allocations) : []);
  const already = Number(r.reversed_cents || 0); const total = Number(r.amount_discounted_cents || 0);
  if (r.status === 'applied') return lineIds ? { kind: 'keep', shareCents: 0, nextReversedCents: already, placeReturned: false } : { kind: 'release', shareCents: 0, nextReversedCents: already, placeReturned: true };
  const allLines = !lineIds || !alloc.length || alloc.every((a) => a.cents <= 0 || lineIds.includes(a.lineId));
  if (allLines) return { kind: 'reverse', shareCents: total - already, nextReversedCents: total, placeReturned: true };
  const share = alloc.filter((a) => lineIds.includes(a.lineId)).reduce((n, a) => n + a.cents, 0);
  if (share > 0) { const next = Math.min(total, already + share); return { kind: 'partial', shareCents: next - already, nextReversedCents: next, placeReturned: false }; }
  return { kind: 'none', shareCents: 0, nextReversedCents: already, placeReturned: false };
}
