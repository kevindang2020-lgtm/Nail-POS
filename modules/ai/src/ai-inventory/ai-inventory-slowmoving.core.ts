// ai-inventory-slowmoving.core.ts — pure slow-moving / dead-stock classification (§20–§21). Analysis only; never mutates,
// never changes price, never disposes. It classifies from AUTHORITATIVE velocity signals (days since last sale/usage,
// units moved in a window) and honours a new-product grace period so a freshly-launched item is NEVER called dead stock
// before it has had a fair chance to sell (§20). Thresholds are inputs (settings-driven later); defaults are conservative.

export type MovementClass =
  | 'healthy' | 'slow_moving' | 'very_slow' | 'dead_stock' | 'new_insufficient_data';

export type SlowMovingConfidence = 'high' | 'medium' | 'low' | 'insufficient_data';

export interface SlowMovingThresholds {
  newGraceDays: number;    // below this age → never classified as dead/slow
  slowDays: number;        // no activity for ≥ this → slow
  verySlowDays: number;    // ≥ this → very slow
  deadDays: number;        // ≥ this → dead stock
  windowDays: number;      // velocity measurement window
}

export const DEFAULT_THRESHOLDS: SlowMovingThresholds = {
  newGraceDays: 30, slowDays: 30, verySlowDays: 60, deadDays: 90, windowDays: 90,
};

export interface SlowMovingInputs {
  onHand: number;
  costCents: number | null;
  maximumStock?: number | null;
  productAgeDays: number;              // now − product created_at
  daysSinceLastSale: number | null;    // null = never sold
  daysSinceLastUsage: number | null;   // null = never used
  retailUnitsInWindow: number;
  consumptionUnitsInWindow: number;
  isConsumable: boolean;               // drives which velocity matters
}

export interface SlowMovingResult {
  classification: MovementClass;
  overstock: boolean;
  daysSinceLastActivity: number | null; // most recent of sale/usage
  salesVelocityPerWeek: number;
  usageVelocityPerWeek: number;
  inventoryValueCents: number | null;   // onHand × cost (null when cost unknown)
  confidence: SlowMovingConfidence;
  recommendation: string;
}

function perWeek(unitsInWindow: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return Math.round((unitsInWindow / windowDays) * 7 * 100) / 100;
}

/** Most recent activity in days (min of sale/usage), or null when the item has never moved. */
export function daysSinceLastActivity(sale: number | null, usage: number | null): number | null {
  const vals = [sale, usage].filter((v): v is number => v != null);
  return vals.length === 0 ? null : Math.min(...vals);
}

function recommend(cls: MovementClass, overstock: boolean): string {
  switch (cls) {
    case 'new_insufficient_data': return 'Newly added — keep monitoring; not enough history to classify yet.';
    case 'dead_stock': return 'No recent movement. Consider reducing/pausing reorders, transferring to a higher-demand branch, or a vendor return where permitted. Verify a cycle count first.';
    case 'very_slow': return 'Very slow. Reduce the next reorder and consider transferring surplus to a higher-demand branch.';
    case 'slow_moving': return overstock
      ? 'Slow with overstock. Reduce reorder quantity and review whether a transfer relieves the surplus.'
      : 'Slower than typical. Review the reorder rule before the next order.';
    default: return overstock ? 'Healthy movement but stock exceeds the maximum — review reorder quantity.' : 'Healthy movement.';
  }
}

export function classifySlowMoving(i: SlowMovingInputs, t: SlowMovingThresholds = DEFAULT_THRESHOLDS): SlowMovingResult {
  const salesVelocityPerWeek = perWeek(Math.max(0, i.retailUnitsInWindow), t.windowDays);
  const usageVelocityPerWeek = perWeek(Math.max(0, i.consumptionUnitsInWindow), t.windowDays);
  const inventoryValueCents = i.costCents == null ? null : Math.max(0, i.onHand) * i.costCents;
  const overstock = i.maximumStock != null && i.maximumStock > 0 && i.onHand > i.maximumStock;

  // The activity signal that matters for this item's type; fall back to whichever exists.
  const primary = i.isConsumable ? i.daysSinceLastUsage : i.daysSinceLastSale;
  const activity = primary != null ? primary : daysSinceLastActivity(i.daysSinceLastSale, i.daysSinceLastUsage);

  let classification: MovementClass;
  let confidence: SlowMovingConfidence;

  if (i.productAgeDays < t.newGraceDays) {
    classification = 'new_insufficient_data';
    confidence = 'insufficient_data';
  } else if (activity == null) {
    // Old enough, never moved, and has stock → dead. No stock → treat as healthy (nothing sitting).
    classification = i.onHand > 0 ? 'dead_stock' : 'healthy';
    confidence = 'medium';
  } else if (activity >= t.deadDays) { classification = 'dead_stock'; confidence = 'high'; }
  else if (activity >= t.verySlowDays) { classification = 'very_slow'; confidence = 'high'; }
  else if (activity >= t.slowDays) { classification = 'slow_moving'; confidence = 'medium'; }
  else { classification = 'healthy'; confidence = 'high'; }

  return {
    classification, overstock,
    daysSinceLastActivity: daysSinceLastActivity(i.daysSinceLastSale, i.daysSinceLastUsage),
    salesVelocityPerWeek, usageVelocityPerWeek, inventoryValueCents, confidence,
    recommendation: recommend(classification, overstock),
  };
}
