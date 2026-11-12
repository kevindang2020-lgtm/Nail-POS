// Discount Exposure Meter (Extras backlog · Promotions Management 09): the most this promotion could still give away,
// from its own allowed uses, per-ticket cap and budget. An ESTIMATE (an upper bound), never a forecast: when a bound is
// missing (unlimited uses, a percent deal without a cap, no budget) it says which, instead of guessing a figure.
export type ExposureInput = { discountType: string; discountCents?: number | null; maxDiscountCents?: number | null; maxRedemptions?: number | null;
  remaining?: number | null; used?: number | null; budgetCents?: number | null; savingsCents?: number | null };
export type Exposure = {
  perUse: number | null;          // largest saving one redemption can give (null = no cap on a percent deal)
  usesLeft: number | null;        // null = unlimited
  byUses: number | null;          // perUse × usesLeft
  budgetLeft: number | null;      // budget − confirmed savings so far
  estimate: number | null;        // the tightest known bound; null = no ceiling
  limitedBy: 'uses' | 'budget' | null;
};

export function exposure(x: ExposureInput): Exposure {
  const cap = x.maxDiscountCents != null && x.maxDiscountCents > 0 ? x.maxDiscountCents : null;
  const perUse = x.discountType === 'percent' ? cap : (() => { const f = Math.max(0, Math.floor(x.discountCents ?? 0)); return cap != null ? Math.min(f, cap) : f; })();
  const usesLeft = x.maxRedemptions == null ? null : Math.max(0, x.remaining ?? (x.maxRedemptions - (x.used ?? 0)));
  const byUses = perUse != null && usesLeft != null ? perUse * usesLeft : null;
  const budgetLeft = x.budgetCents != null ? Math.max(0, x.budgetCents - (x.savingsCents ?? 0)) : null;
  const bounds = [byUses != null ? { v: byUses, k: 'uses' as const } : null, budgetLeft != null ? { v: budgetLeft, k: 'budget' as const } : null].filter(Boolean) as { v: number; k: 'uses' | 'budget' }[];
  const best = bounds.sort((a, b) => a.v - b.v)[0] ?? null;
  return { perUse, usesLeft, byUses, budgetLeft, estimate: best ? best.v : null, limitedBy: best ? best.k : null };
}
