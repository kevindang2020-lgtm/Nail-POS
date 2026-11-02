import type { TierBand } from '@aipowersalon/api-contracts/tenant';
export type { TierBand };   // owned by packages/api-contracts (Constitution 13 §13)

export interface TieredResult {
  commissionCents: number;
  /** the rate applied (entire-period) or the blended effective rate (marginal), to 2 dp. */
  effectiveRatePercent: number;
}

/** Sort ascending by bound, treating the open-ended (null) band as the top. */
function sortBands(bands: TierBand[]): TierBand[] {
  return [...bands].sort((a, b) => (a.uptoCents ?? Number.POSITIVE_INFINITY) - (b.uptoCents ?? Number.POSITIVE_INFINITY));
}

/** True when bands are usable: at least one, ascending bounds, rates in range, and no gap above the last bounded band. */
export function validateTiers(bands: TierBand[]): string | null {
  if (!bands || bands.length === 0) return 'at least one tier band is required';
  const s = sortBands(bands);
  let prev = -1;
  for (let i = 0; i < s.length; i++) {
    const b = s[i];
    if (!Number.isFinite(b.ratePercent) || b.ratePercent < 0 || b.ratePercent > 100) return 'each tier rate must be between 0 and 100';
    if (b.uptoCents == null) { if (i !== s.length - 1) return 'only the top band may be open-ended'; continue; }
    if (!Number.isFinite(b.uptoCents) || b.uptoCents <= prev) return 'tier bounds must strictly increase';
    prev = b.uptoCents;
  }
  return null;
}

export function computeTieredCommission(productionCents: number, bands: TierBand[], mode: 'entire' | 'marginal'): TieredResult {
  const p = Math.max(0, Math.round(productionCents || 0));
  const s = sortBands(bands);
  if (s.length === 0) return { commissionCents: 0, effectiveRatePercent: 0 };

  if (mode === 'entire') {
    const band = s.find((b) => b.uptoCents == null || p <= b.uptoCents) ?? s[s.length - 1];
    return { commissionCents: Math.round((p * band.ratePercent) / 100), effectiveRatePercent: band.ratePercent };
  }

  // marginal: each band's rate applies only to the slice of production within [prevBound, thisBound]
  let prev = 0;
  let total = 0;
  for (const b of s) {
    const top = b.uptoCents == null ? p : Math.min(p, b.uptoCents);
    const portion = Math.max(0, top - prev);
    if (portion > 0) total += Math.round((portion * b.ratePercent) / 100);
    prev = b.uptoCents == null ? p : b.uptoCents;
    if (b.uptoCents != null && p <= b.uptoCents) break;
  }
  const eff = p > 0 ? Math.round((total / p) * 10000) / 100 : 0;
  return { commissionCents: total, effectiveRatePercent: eff };
}
