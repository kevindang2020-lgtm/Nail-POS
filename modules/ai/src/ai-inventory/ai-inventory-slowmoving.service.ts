// ai-inventory-slowmoving.service.ts — slow-moving / dead-stock findings (§20–§21). READ-ONLY: it classifies from the
// authoritative velocity read and returns evidence + non-mutating recommendations. It NEVER changes price, creates a
// discount, transfers, or disposes stock — those remain human/authorized workflows. Inventory value is hidden from
// cost-blind roles. A new-product grace period prevents calling a fresh item dead (§20).
import { classifySlowMoving, DEFAULT_THRESHOLDS, type MovementClass, type SlowMovingConfidence, type SlowMovingThresholds } from './ai-inventory-slowmoving.core';
import { requireInventoryView, costVisible } from './ai-inventory-access';
import type { AiInventoryContext } from './ai-inventory.dto';
import type { InventoryReadPort } from './ai-inventory.port';

export interface SlowMovingItem {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  onHand: number;
  inventoryValueCents: number | null; // null when cost hidden/unknown
  daysSinceLastActivity: number | null;
  salesVelocityPerWeek: number;
  usageVelocityPerWeek: number;
  classification: MovementClass;
  overstock: boolean;
  confidence: SlowMovingConfidence;
  recommendation: string;
}

const MAX = 500;
const INCLUDE: MovementClass[] = ['slow_moving', 'very_slow', 'dead_stock']; // findings only surface non-healthy items

export class AiInventorySlowMovingService {
  constructor(private readonly read: InventoryReadPort, private readonly thresholds: SlowMovingThresholds = DEFAULT_THRESHOLDS) {}

  async getSlowMoving(ctx: AiInventoryContext, opts: { includeNew?: boolean } = {}): Promise<{ branchId: string; costVisible: boolean; windowDays: number; items: SlowMovingItem[] }> {
    requireInventoryView(ctx);
    const showCost = costVisible(ctx);
    const rows = await this.read.listSlowMovingInputs(ctx.tenantId, ctx.branchId, this.thresholds.windowDays, MAX);
    const items: SlowMovingItem[] = [];
    for (const row of rows) {
      const r = classifySlowMoving({
        onHand: row.onHand, costCents: showCost ? row.costCents : null, maximumStock: row.maximumStock,
        productAgeDays: row.productAgeDays, daysSinceLastSale: row.daysSinceLastSale, daysSinceLastUsage: row.daysSinceLastUsage,
        retailUnitsInWindow: row.retailUnitsInWindow, consumptionUnitsInWindow: row.consumptionUnitsInWindow,
        isConsumable: (row.inventoryType ?? '') !== 'retail', // retail unit_type sells; everything else is service-consumed
      }, this.thresholds);

      const show = INCLUDE.includes(r.classification) || (opts.includeNew && r.classification === 'new_insufficient_data') || r.overstock;
      if (!show) continue;

      items.push({
        productId: row.productId, name: row.name, sku: row.sku, categoryName: row.categoryName,
        onHand: row.onHand, inventoryValueCents: r.inventoryValueCents,
        daysSinceLastActivity: r.daysSinceLastActivity, salesVelocityPerWeek: r.salesVelocityPerWeek, usageVelocityPerWeek: r.usageVelocityPerWeek,
        classification: r.classification, overstock: r.overstock, confidence: r.confidence, recommendation: r.recommendation,
      });
    }
    // Worst first: dead → very_slow → slow → (overstock-only healthy). Tie-break by inventory value (descending).
    const rank: Record<MovementClass, number> = { dead_stock: 4, very_slow: 3, slow_moving: 2, new_insufficient_data: 1, healthy: 0 };
    items.sort((a, b) => rank[b.classification] - rank[a.classification] || (b.inventoryValueCents ?? 0) - (a.inventoryValueCents ?? 0));
    return { branchId: ctx.branchId, costVisible: showCost, windowDays: this.thresholds.windowDays, items };
  }
}
