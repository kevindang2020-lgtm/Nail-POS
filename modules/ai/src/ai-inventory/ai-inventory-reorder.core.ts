// ai-inventory-reorder.core.ts — pure low-stock + reorder math (§16–§18). Analysis only; never mutates and never
// auto-orders. It uses the AUTHORITATIVE static reorder point + configured reorder quantity, and correctly nets out the
// confirmed inbound already wired from open POs (§17: reorder = target − available − confirmed inbound). Safety stock,
// case-pack, and vendor minimums are NOT modelled in the current schema, so they are treated as unset (0 / “—”) rather
// than guessed — the caller surfaces that as a data-quality note and caps confidence accordingly.

export type LowStockSeverity = 'none' | 'low' | 'critical' | 'out_of_stock';
export type ReorderConfidence = 'medium' | 'low' | 'insufficient_data';

export interface ReorderInputs {
  sellableAvailable: number; // available to sell now (usable − reserved)
  confirmedInbound: number;  // open PO qty en route
  reorderLevel: number;      // authoritative reorder point
  reorderQuantity: number;   // authoritative configured batch size (0 when unset)
  criticalLevel?: number | null;
  safetyStock?: number | null; // not in schema today → null
  leadTimeDays?: number | null; // preferred vendor lead time; null when unknown
  avgDailyUsage?: number | null; // from forecast slice; null today
}

export interface ReorderResult {
  severity: LowStockSeverity;
  belowReorderPoint: boolean;
  targetStock: number;
  projectedAvailable: number;  // sellable + confirmed inbound
  suggestedQuantity: number;   // 0 when inbound already covers the need
  coveredByInbound: boolean;
  confidence: ReorderConfidence;
  usesStaticReorderPoint: boolean; // true until forecast+lead-time drive the point
}

/** Low-stock severity from usable-on-hand vs reorder/critical levels (mirrors the domain's status buckets). */
export function lowStockSeverity(sellableAvailable: number, reorderLevel: number, criticalLevel?: number | null): LowStockSeverity {
  if (sellableAvailable <= 0) return 'out_of_stock';
  const crit = criticalLevel != null && criticalLevel > 0 ? criticalLevel : (reorderLevel > 0 ? Math.ceil(reorderLevel / 2) : 0);
  if (crit > 0 && sellableAvailable <= crit) return 'critical';
  if (reorderLevel > 0 && sellableAvailable <= reorderLevel) return 'low';
  return 'none';
}

/** Round a positive need up to the nearest configured batch (reorderQuantity) when set; otherwise return the need. */
export function roundToBatch(need: number, batch: number): number {
  if (need <= 0) return 0;
  if (batch <= 0) return need;
  return Math.ceil(need / batch) * batch;
}

export function computeReorder(i: ReorderInputs): ReorderResult {
  const sellable = Math.max(0, i.sellableAvailable);
  const inbound = Math.max(0, i.confirmedInbound);
  const safety = Math.max(0, i.safetyStock ?? 0);
  const targetStock = Math.max(0, i.reorderLevel) + safety;
  const projectedAvailable = sellable + inbound;
  const severity = lowStockSeverity(sellable, i.reorderLevel, i.criticalLevel);
  const belowReorderPoint = i.reorderLevel > 0 && sellable <= i.reorderLevel;

  // Need is measured against projected available (so we don't double-order what's already inbound).
  const rawNeed = Math.max(0, targetStock - projectedAvailable);
  const coveredByInbound = belowReorderPoint && rawNeed <= 0;
  const suggestedQuantity = rawNeed > 0 ? roundToBatch(rawNeed, i.reorderQuantity) : 0;

  // Confidence: without usage/lead-time this is a static-reorder-point recommendation → never above 'low'.
  const hasForecast = i.avgDailyUsage != null && i.leadTimeDays != null;
  const confidence: ReorderConfidence = hasForecast ? 'medium' : (i.reorderLevel > 0 ? 'low' : 'insufficient_data');

  return {
    severity, belowReorderPoint, targetStock, projectedAvailable,
    suggestedQuantity, coveredByInbound, confidence, usesStaticReorderPoint: !hasForecast,
  };
}
