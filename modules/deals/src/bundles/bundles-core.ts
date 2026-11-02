// bundles-core.ts — framework-free math for Bundles / Packages / Membership Add-ons.
// Pure, deterministic, unit-tested. Savings are always derived from the component price SNAPSHOTS captured on each
// bundle item (never recomputed from a live cross-table join), which keeps savings deterministic and auditable and
// means two concurrent writers can't disagree about a bundle's savings. Money is integer cents everywhere.

export type BundleKind = 'bundle' | 'package' | 'membership' | 'promo';
export type BundleStatus = 'active' | 'inactive' | 'archived';
export type BundleItemType = 'service' | 'product';

export const BUNDLE_KINDS: readonly BundleKind[] = ['bundle', 'package', 'membership', 'promo'] as const;
export const BUNDLE_STATUSES: readonly BundleStatus[] = ['active', 'inactive', 'archived'] as const;
export const BUNDLE_ITEM_TYPES: readonly BundleItemType[] = ['service', 'product'] as const;

export function isBundleKind(v: unknown): v is BundleKind { return typeof v === 'string' && (BUNDLE_KINDS as readonly string[]).includes(v); }
export function isBundleStatus(v: unknown): v is BundleStatus { return typeof v === 'string' && (BUNDLE_STATUSES as readonly string[]).includes(v); }
export function isBundleItemType(v: unknown): v is BundleItemType { return typeof v === 'string' && (BUNDLE_ITEM_TYPES as readonly string[]).includes(v); }

export interface BundleItemPrice { quantity: number; unitPriceCents: number; }

/** Σ floor(quantity) × unitPriceCents over all items. Fractional quantities are floored (you can't bundle 2.9 bottles). */
export function componentsTotalCents(items: BundleItemPrice[]): number {
  let total = 0;
  for (const it of items) {
    const qty = Math.max(0, Math.floor(Number(it.quantity) || 0));
    const unit = Math.max(0, Math.round(Number(it.unitPriceCents) || 0));
    total += qty * unit;
  }
  return total;
}

/** Savings = components − bundle price, floored at 0 (a bundle priced ABOVE its parts shows $0 saving, never negative). */
export function savingsCents(componentsTotal: number, bundlePriceCents: number): number {
  return Math.max(0, Math.round(componentsTotal) - Math.max(0, Math.round(bundlePriceCents)));
}

/** Savings as a whole-percent of the component total (0 when there are no priced components). */
export function savingsPct(componentsTotal: number, bundlePriceCents: number): number {
  const ct = Math.round(componentsTotal);
  if (ct <= 0) return 0;
  return Math.round((savingsCents(ct, bundlePriceCents) / ct) * 100);
}

/** A bundle is live now if it's active AND inside its optional [startsAt, endsAt] window (limited-time / seasonal). */
export function isActiveNow(status: BundleStatus, startsAt: string | null, endsAt: string | null, nowIso: string): boolean {
  if (status !== 'active') return false;
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return status === 'active';
  if (startsAt) { const s = Date.parse(startsAt); if (!Number.isNaN(s) && now < s) return false; }
  if (endsAt) { const e = Date.parse(endsAt); if (!Number.isNaN(e) && now > e) return false; }
  return true;
}

/** endsAt must be strictly after startsAt when both are supplied. */
export function isValidWindow(startsAt: string | null, endsAt: string | null): boolean {
  if (!startsAt || !endsAt) return true;
  const s = Date.parse(startsAt), e = Date.parse(endsAt);
  if (Number.isNaN(s) || Number.isNaN(e)) return true; // parse handled elsewhere; don't reject on unparseable here
  return e > s;
}

export interface BundleSummaryRow { kind: BundleKind; status: BundleStatus; priceCents: number; componentsTotalCents: number; startsAt: string | null; endsAt: string | null; }
export interface BundleKpis {
  totalBundles: number; activeBundles: number; inactiveBundles: number; liveNow: number;
  byKind: Record<BundleKind, number>;
  totalSavingsCents: number;   // Σ savings of ACTIVE bundles
  avgSavingsPct: number;       // mean savings% across ACTIVE bundles that have priced components
}

/** Catalog-level KPIs derived purely from the bundle rows. Revenue ("Package Sales") is NOT here — it needs ticket
 *  data and is wired from canonical reporting, not invented from the catalog. */
export function summarize(rows: BundleSummaryRow[], nowIso: string): BundleKpis {
  const byKind: Record<BundleKind, number> = { bundle: 0, package: 0, membership: 0, promo: 0 };
  let active = 0, inactive = 0, live = 0, totalSavings = 0, pctSum = 0, pctCount = 0;
  for (const r of rows) {
    if (isBundleKind(r.kind)) byKind[r.kind]++;
    if (r.status === 'active') {
      active++;
      const sav = savingsCents(r.componentsTotalCents, r.priceCents);
      totalSavings += sav;
      if (r.componentsTotalCents > 0) { pctSum += savingsPct(r.componentsTotalCents, r.priceCents); pctCount++; }
      if (isActiveNow(r.status, r.startsAt, r.endsAt, nowIso)) live++;
    } else if (r.status === 'inactive') { inactive++; }
  }
  return {
    totalBundles: rows.length, activeBundles: active, inactiveBundles: inactive, liveNow: live,
    byKind, totalSavingsCents: totalSavings, avgSavingsPct: pctCount ? Math.round(pctSum / pctCount) : 0,
  };
}
