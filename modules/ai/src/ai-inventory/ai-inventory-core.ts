// ai-inventory-core.ts — pure, framework-free inventory-intelligence math for the AI Inventory Assistant.
// This is an ANALYSIS layer only: it never mutates stock. It reuses the authoritative inventory domain's concepts
// (StockStatus, on-hand/available/reserved/damaged) and derives the projected inventory POSITION (§10), days-of-supply,
// and a confidence/data-quality signal. Every number here is derived from authoritative inputs the caller supplies from
// the existing inventory ledger — nothing is invented. Kept side-effect-free so the logic is testable without Nest/DB.

export type StockStatus = 'in_stock' | 'low' | 'critical' | 'out_of_stock' | 'overstock';
export type PositionConfidence = 'high' | 'medium' | 'low' | 'insufficient_data';

/** Authoritative quantities for one product at one branch, read from inventory_location_stock (+ open PO/transfer rollups
 *  once the procurement-read slice wires them). `inboundKnown` is honest: false until those rollups are wired, so the UI
 *  renders inbound as “—” rather than a fabricated zero. */
export interface PositionInputs {
  onHand: number;            // physical usable on-hand (unopened+opened+low) — excludes damaged/expired
  reserved: number;          // committed to an order/workflow
  damaged: number;           // unavailable
  expired: number;           // unavailable
  quarantined: number;       // unavailable
  confirmedInbound: number;  // approved/ordered PO qty not yet received
  inTransitInbound: number;  // transfer shipped toward this branch, not yet received
  inTransitOutbound: number; // transfer shipped away from this branch
  inboundKnown: boolean;     // whether confirmedInbound/inTransit* are actually wired (vs not-yet-known)
  reorderLevel: number;
  reorderQuantity: number;
  criticalLevel?: number | null;
  maximumStock?: number | null;
  avgDailyUsage?: number | null; // from the forecast/consumption slice; null → days-of-supply unknown
  usageHistoryDays?: number;     // how much history backs avgDailyUsage (drives confidence)
}

export interface InventoryPosition {
  physicalOnHand: number;      // usable + damaged (everything physically present, sellable or not)
  sellableOnHand: number;      // usable and not reserved (available to sell now)
  reserved: number;
  unavailable: number;         // damaged + expired + quarantined
  confirmedInbound: number;
  inTransitInbound: number;
  inTransitOutbound: number;
  projectedAvailable: number;  // §10 projected available position
  status: StockStatus;
  daysOfSupply: number | null; // sellable / avgDailyUsage; null when usage unknown
  confidence: PositionConfidence;
  dataComplete: boolean;       // false when inbound/in-transit are not yet wired
}

/** Stock status from usable on-hand vs reorder/limits — identical rule to the authoritative inventory-core.stockStatus,
 *  duplicated here (not imported) only to keep this module framework/domain-decoupled; kept in lockstep by tests. */
export function positionStatus(onHand: number, reorderLevel: number, maximumStock?: number | null, criticalLevel?: number | null): StockStatus {
  if (onHand <= 0) return 'out_of_stock';
  const crit = criticalLevel != null && criticalLevel > 0 ? criticalLevel : (reorderLevel > 0 ? Math.ceil(reorderLevel / 2) : 0);
  if (crit > 0 && onHand <= crit) return 'critical';
  if (reorderLevel > 0 && onHand <= reorderLevel) return 'low';
  if (maximumStock && maximumStock > 0 && onHand > maximumStock) return 'overstock';
  return 'in_stock';
}

/** Days of supply = sellable ÷ average daily usage. Null when usage is unknown or non-positive (avoids divide-by-zero and
 *  false precision — the caller renders “—”). Rounded to one decimal. */
export function daysOfSupply(sellable: number, avgDailyUsage?: number | null): number | null {
  if (avgDailyUsage == null || avgDailyUsage <= 0) return null;
  return Math.round((Math.max(0, sellable) / avgDailyUsage) * 10) / 10;
}

/** Confidence in the position/forecast, from data completeness — never overclaims. */
export function positionConfidence(inboundKnown: boolean, avgDailyUsage: number | null | undefined, historyDays: number | undefined): PositionConfidence {
  if (avgDailyUsage == null) return 'insufficient_data';
  const h = historyDays ?? 0;
  if (!inboundKnown) return 'low';           // position missing inbound/in-transit → can't be high/medium
  if (h >= 56) return 'high';
  if (h >= 21) return 'medium';
  if (h >= 7) return 'low';
  return 'insufficient_data';
}

/** Compute the full §10 inventory position from authoritative inputs. Pure. */
export function computePosition(i: PositionInputs): InventoryPosition {
  const usable = Math.max(0, i.onHand);
  const physicalOnHand = usable + Math.max(0, i.damaged);
  const sellableOnHand = Math.max(0, usable - Math.max(0, i.reserved));
  const unavailable = Math.max(0, i.damaged) + Math.max(0, i.expired) + Math.max(0, i.quarantined);
  const confirmedInbound = i.inboundKnown ? Math.max(0, i.confirmedInbound) : 0;
  const inTransitInbound = i.inboundKnown ? Math.max(0, i.inTransitInbound) : 0;
  const inTransitOutbound = i.inboundKnown ? Math.max(0, i.inTransitOutbound) : 0;
  const projectedAvailable = sellableOnHand + confirmedInbound + inTransitInbound - inTransitOutbound;
  return {
    physicalOnHand, sellableOnHand, reserved: Math.max(0, i.reserved), unavailable,
    confirmedInbound, inTransitInbound, inTransitOutbound, projectedAvailable,
    status: positionStatus(usable, i.reorderLevel, i.maximumStock, i.criticalLevel),
    daysOfSupply: daysOfSupply(sellableOnHand, i.avgDailyUsage),
    confidence: positionConfidence(i.inboundKnown, i.avgDailyUsage, i.usageHistoryDays),
    dataComplete: i.inboundKnown,
  };
}
