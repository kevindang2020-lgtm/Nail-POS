// inventory-core.ts — framework-free stock math for the inventory system. Pure, deterministic, and unit
// tested. Stock counts are always derived from the authoritative bottle/unit rows (never incremented
// blindly), which is what keeps two concurrent writers from corrupting totals. Movement integrity
// (before/change/after) and bottle-lifecycle guards (no double-empty, no double-open) live here too.

export type BottleStatus =
  | 'unopened' | 'opened' | 'low' | 'empty' | 'damaged' | 'expired' | 'missing' | 'returned' | 'disposed'
  | 'sold';   // sold to a guest at retail — leaves the salon, so it is NOT on-hand (see countsFromUnits)
export type StockStatus = 'in_stock' | 'low' | 'critical' | 'out_of_stock' | 'overstock';
export type MovementType =
  | 'opening_balance' | 'purchase_received' | 'manual_add' | 'service_usage' | 'retail_sale'
  | 'bottle_opened' | 'bottle_empty' | 'technician_report' | 'damaged' | 'expired' | 'missing'
  | 'waste' | 'adjustment_increase' | 'adjustment_decrease' | 'transfer_out' | 'transfer_in'
  | 'return_to_vendor' | 'customer_return' | 'correction'
  // Stock Alerts + Technician Product Usage (Oct 29 2026): a technician's recorded use, and a correction of one (never an edit)
  | 'technician_usage' | 'usage_correction';

// usable (on-hand) statuses contribute to availability; spent/lost statuses do not
const USABLE: BottleStatus[] = ['unopened', 'opened', 'low'];

export interface StockCounts {
  onHand: number; available: number; unopened: number; open: number; low: number; empty: number; damaged: number;
}

/** Derive all stock counts from the bottle rows — the single source of truth. */
export function countsFromUnits(units: { status: BottleStatus }[], reserved = 0): StockCounts {
  let unopened = 0, opened = 0, low = 0, empty = 0, damaged = 0;
  for (const u of units) {
    switch (u.status) {
      case 'unopened': unopened++; break;
      case 'opened': opened++; break;
      case 'low': low++; break;
      case 'empty': empty++; break;
      case 'damaged': damaged++; break;
      default: break; // expired/missing/returned/disposed/sold are not on-hand
    }
  }
  const onHand = unopened + opened + low;
  return { onHand, available: Math.max(0, onHand - reserved), unopened, open: opened + low, low, empty, damaged };
}

/** Stock status from usable on-hand vs reorder/limits. */
export function stockStatus(onHand: number, reorderLevel: number, maximumStock?: number | null, criticalLevel?: number | null): StockStatus {
  if (onHand <= 0) return 'out_of_stock';
  // Explicit critical_level when set; otherwise the legacy derived half-of-reorder threshold.
  const crit = criticalLevel != null && criticalLevel > 0 ? criticalLevel : (reorderLevel > 0 ? Math.ceil(reorderLevel / 2) : 0);
  if (crit > 0 && onHand <= crit) return 'critical';
  if (reorderLevel > 0 && onHand <= reorderLevel) return 'low';
  if (maximumStock && maximumStock > 0 && onHand > maximumStock) return 'overstock';
  return 'in_stock';
}

/** Suggested reorder quantity when at/below the reorder point (0 when not needed). */
export function reorderSuggestion(onHand: number, reorderLevel: number, reorderQuantity: number, onOrder = 0): number {
  if (reorderLevel <= 0 || onHand > reorderLevel) return 0;
  // audit D9 (Nov 4 2026): what is already on order (approved / ordered / partly received — never a draft) is subtracted,
  // so a product with a purchase order on the way is not suggested again
  return Math.max(0, Math.max(reorderQuantity, reorderLevel - onHand) - Math.max(0, onOrder));
}

// ---- bottle lifecycle guards ----
const BOTTLE_TRANSITIONS: Record<BottleStatus, BottleStatus[]> = {
  unopened: ['opened', 'damaged', 'expired', 'missing', 'returned', 'sold'],   // a sealed unit is what gets sold at retail
  opened: ['low', 'empty', 'damaged', 'expired', 'missing'],
  low: ['empty', 'damaged', 'expired', 'missing', 'opened'],
  empty: ['disposed'],
  damaged: ['disposed', 'returned'],
  expired: ['disposed'],
  missing: ['opened', 'unopened'],   // found again
  returned: [], disposed: [],
  // A sold unit has left the salon. 'returned' is the manual way back (a vendor / customer return handled by hand).
  // B-17 (Oct 20 2026): 'unopened' is the AUTOMATIC way back — the sale itself reversed (the line removed before
  // payment, the ticket voided, the sale refunded): reverseRetailSale() puts exactly the units that sale took back.
  sold: ['returned', 'unopened'],
};
export function canTransitionBottle(from: BottleStatus, to: BottleStatus): boolean {
  if (from === to) return false; // no-op transitions are rejected (prevents double-empty / double-open)
  return (BOTTLE_TRANSITIONS[from] || []).includes(to);
}

/** Movement integrity: after = before + change, and stock never goes negative unless explicitly allowed. */
export function applyMovement(before: number, change: number, allowNegative = false): { before: number; change: number; after: number; ok: boolean } {
  const after = before + change;
  return { before, change, after, ok: allowNegative || after >= 0 };
}

/** Validate a technician report against the current bottle status (returns null if OK, else a reason). */
export function validateTechReport(reportType: string, bottleStatus?: BottleStatus | null): string | null {
  if (!bottleStatus) return null; // product-level report (no specific bottle)
  if (reportType === 'bottle_empty' && bottleStatus === 'empty') return 'Bottle is already marked empty';
  if (reportType === 'open_new' && (bottleStatus === 'opened' || bottleStatus === 'low')) return 'Bottle is already open';
  if (reportType === 'bottle_low' && (bottleStatus === 'empty')) return 'Bottle is already empty';
  if ((bottleStatus === 'disposed' || bottleStatus === 'returned')) return 'Bottle is no longer in inventory';
  return null;
}

/** Build a summary across many product stock rows (for the Inventory Overview cards). */
export function summarize(rows: { onHand: number; unopened: number; open: number; empty: number; reorderLevel: number; maximumStock?: number | null; valueCents?: number; expiringSoon?: boolean }[]) {
  let totalProducts = 0, totalBottles = 0, openBottles = 0, unopenedBottles = 0, lowStock = 0, outOfStock = 0, expiringSoon = 0, valueCents = 0;
  for (const r of rows) {
    totalProducts++;
    totalBottles += r.onHand;
    openBottles += r.open;
    unopenedBottles += r.unopened;
    valueCents += r.valueCents || 0;
    if (r.expiringSoon) expiringSoon++;
    const st = stockStatus(r.onHand, r.reorderLevel, r.maximumStock);
    if (st === 'out_of_stock') outOfStock++;
    else if (st === 'low' || st === 'critical') lowStock++;
  }
  return { totalProducts, totalBottles, openBottles, unopenedBottles, lowStock, outOfStock, expiringSoon, valueCents };
}

// ---- purchase orders (§18) — framework-free helpers, unit tested ----
export type POStatus = 'draft' | 'approved' | 'ordered' | 'partial' | 'received' | 'cancelled' | 'closed';

/** A PO's receiving progress derived from its lines (the single source of truth for partial/received). */
export function poReceivingStatus(lines: { quantityOrdered: number; quantityReceived: number }[]): 'none' | 'partial' | 'received' {
  if (lines.length === 0) return 'none';
  let anyReceived = false, allReceived = true, anyOrdered = false;
  for (const l of lines) {
    const ord = Math.max(0, l.quantityOrdered), recv = Math.max(0, l.quantityReceived);
    if (ord > 0) anyOrdered = true;
    if (recv > 0) anyReceived = true;
    if (recv < ord) allReceived = false;
  }
  if (!anyOrdered) return 'none';
  return allReceived ? 'received' : anyReceived ? 'partial' : 'none';
}

/** Units of a line still receivable, clamped so received never exceeds ordered (prevents over-receive). */
export function receivableQty(ordered: number, alreadyReceived: number, incoming: number): number {
  const remaining = Math.max(0, Math.max(0, ordered) - Math.max(0, alreadyReceived));
  return Math.max(0, Math.min(remaining, Math.floor(Math.max(0, incoming))));
}

/** PO money totals from lines + shipping/tax, all integer cents. */
export function poTotals(lines: { quantityOrdered: number; unitCostCents: number }[], shippingCents = 0, taxCents = 0): { subtotalCents: number; totalCents: number } {
  let subtotal = 0;
  for (const l of lines) subtotal += Math.max(0, l.quantityOrdered) * Math.max(0, l.unitCostCents);
  return { subtotalCents: subtotal, totalCents: subtotal + Math.max(0, shippingCents) + Math.max(0, taxCents) };
}

/** Whether a PO in `status` may currently be received against. */
export function canReceivePO(status: POStatus): boolean {
  return status === 'approved' || status === 'ordered' || status === 'partial';
}

/** Allowed PO lifecycle transitions (mirrors the bottle guard pattern; rejects illegal jumps). */
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['ordered', 'partial', 'received', 'cancelled'],
  ordered: ['partial', 'received', 'cancelled'],
  partial: ['partial', 'received', 'cancelled'],
  received: ['closed'],
  cancelled: [],
  closed: [],
};
export function canTransitionPO(from: POStatus, to: POStatus): boolean {
  return (PO_TRANSITIONS[from] || []).includes(to);
}

// ---- branch transfers (§19) — framework-free helpers, unit tested ----
// Only sellable on-hand bottles move between branches; empty / damaged / expired / missing / disposed stay put.
const MOVABLE_STATUSES: BottleStatus[] = ['unopened', 'opened', 'low'];
export function isMovableUnit(s: BottleStatus): boolean { return MOVABLE_STATUSES.includes(s); }
export function movableCount(units: { status: BottleStatus }[]): number { return units.reduce((n, u) => n + (isMovableUnit(u.status) ? 1 : 0), 0); }
/** How many units may actually move, clamped to what's available at the source (never negative/over). */
export function clampMove(requested: number, available: number): number {
  return Math.max(0, Math.min(Math.floor(Math.max(0, requested)), Math.max(0, available)));
}

// ---- physical inventory counts (§20) — framework-free helpers, unit tested ----
/** A counted quantity is a non-negative integer. */
export function clampCount(n: number): number { return Math.max(0, Math.floor(Math.max(0, n))); }
/** Variance of a count line: counted minus expected (positive = surplus, negative = shrinkage). */
export function countVariance(expected: number, counted: number): number { return clampCount(counted) - Math.max(0, Math.floor(expected)); }
/** Per-line state for display + whether it needs an adjustment. */
export function countLineState(expected: number, counted: number | null | undefined): 'uncounted' | 'match' | 'over' | 'short' {
  if (counted === null || counted === undefined) return 'uncounted';
  const v = countVariance(expected, counted);
  return v === 0 ? 'match' : v > 0 ? 'over' : 'short';
}
/** Roll up a count's lines into headline figures. */
export function summarizeCount(lines: { expectedQty: number; countedQty: number | null }[]): {
  lines: number; counted: number; matched: number; over: number; short: number; netVariance: number; absVariance: number;
} {
  let counted = 0, matched = 0, over = 0, short = 0, net = 0, abs = 0;
  for (const l of lines) {
    if (l.countedQty === null || l.countedQty === undefined) continue;
    counted += 1;
    const v = countVariance(l.expectedQty, l.countedQty);
    net += v; abs += Math.abs(v);
    if (v === 0) matched += 1; else if (v > 0) over += 1; else short += 1;
  }
  return { lines: lines.length, counted, matched, over, short, netVariance: net, absVariance: abs };
}

// ---- service recipes (§13) ----
/** Total per-service product cost of a recipe, in integer cents. */
export function recipeCostCents(lines: { quantity: number | string; costCents: number | null | undefined }[]): number {
  // audit D9: a recipe quantity has up to two decimals (0.1 bottle) — exact in hundredths, rounded once at the end
  const h = lines.reduce((sum, l) => sum + Math.max(0, Math.round(Number(l.quantity || 0) * 100)) * Math.max(0, Math.floor(l.costCents || 0)), 0);
  return Math.round(h / 100);
}
