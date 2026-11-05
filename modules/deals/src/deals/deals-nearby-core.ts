// deals-nearby-core.ts — pure ranking for the customer nearby-deals feed. Reuses the canonical haversineMiles from the
// public salon directory (no new geo system). Given raw active-deal rows joined to branch coordinates and the customer's
// origin, it computes distance, filters to the radius, and sorts. Distance is null when there is no origin (ZIP/city
// fallback or location denied) — never fabricated. Money is integer cents.
import type { NearbyDealCard, NearbyDealRow } from '@aipowersalon/api-contracts/customer';
export type { NearbyDealCard, NearbyDealRow };   // owned by packages/api-contracts (Constitution 13 §13)
import { haversineMiles } from '@aipowersalon/customers';



export type NearbySort = 'nearest' | 'best_value' | 'ending_soon' | 'newest';

const savings = (r: NearbyDealRow): number | null =>
  r.originalPriceCents == null || r.finalPriceCents == null ? null : Math.max(0, r.originalPriceCents - r.finalPriceCents);

/**
 * Build the customer-facing feed: attach distance (haversine, or null with no origin), drop rows outside the radius
 * (only when an origin is known), and sort. Returns at most `limit` cards.
 */
export function buildNearbyFeed(
  rows: NearbyDealRow[],
  origin: { lat: number; lng: number } | null,
  radiusMiles: number,
  sort: NearbySort = 'nearest',
  limit = 100,
): NearbyDealCard[] {
  let cards: NearbyDealCard[] = rows.map((r) => {
    const distanceMiles = origin && r.latitude != null && r.longitude != null
      ? haversineMiles(origin.lat, origin.lng, r.latitude, r.longitude) : null;
    const { latitude, longitude, ...rest } = r;
    return { ...rest, distanceMiles, savingsCents: savings(r) };
  });

  // Radius only applies when we actually have both an origin and a computed distance.
  if (origin) cards = cards.filter((c) => c.distanceMiles != null && c.distanceMiles <= radiusMiles);

  const byDistance = (a: NearbyDealCard, b: NearbyDealCard) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
  switch (sort) {
    case 'best_value': cards.sort((a, b) => (b.savingsCents ?? 0) - (a.savingsCents ?? 0) || byDistance(a, b)); break;
    case 'ending_soon': cards.sort((a, b) => (a.endsAt ? Date.parse(a.endsAt) : Infinity) - (b.endsAt ? Date.parse(b.endsAt) : Infinity) || byDistance(a, b)); break;
    case 'newest': /* rows already arrive newest-first from the query */ break;
    case 'nearest': default: cards.sort(byDistance); break;
  }
  return cards.slice(0, Math.max(1, limit));
}

/** Clamp a requested radius to a sane range (miles). */
export function clampRadius(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(100, Math.max(1, n));
}
