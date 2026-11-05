// deals-redemption-core.ts — pure capacity logic for oversell-safe deal reservations. A deal with a max_redemptions cap
// can be reserved only while (already-redeemed + active holds) is below the cap. NULL cap = unlimited. These functions
// are the single source of truth for capacity; the repository applies them under a per-deal advisory lock so concurrent
// book-a-deal requests can never oversell.

/** Remaining redemptions for a deal, or null when the deal is uncapped (unlimited). */
export function remainingCapacity(maxRedemptions: number | null, redemptionCount: number, activeHolds: number): number | null {
  if (maxRedemptions == null) return null; // unlimited
  return Math.max(0, maxRedemptions - Math.max(0, redemptionCount) - Math.max(0, activeHolds));
}

/** Whether one more reservation may be taken right now. */
export function canReserve(maxRedemptions: number | null, redemptionCount: number, activeHolds: number): boolean {
  const rem = remainingCapacity(maxRedemptions, redemptionCount, activeHolds);
  return rem == null || rem > 0;
}

/** Default hold lifetime while the customer completes booking (ms). */
export const HOLD_TTL_MS = 10 * 60 * 1000;
