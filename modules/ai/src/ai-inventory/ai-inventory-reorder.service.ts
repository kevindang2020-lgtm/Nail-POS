// ai-inventory-reorder.service.ts — low-stock detection (§16) + reorder recommendation cards (§17–§18).
// READ-ONLY analysis: it reads authoritative stock via the port, applies the pure reorder core, and returns
// recommendation cards WITH evidence. It NEVER creates or submits a purchase order — the PO-draft workflow (a later
// slice) is the only path to a mutation, and it always requires human approval. Estimated cost uses the product's own
// cost and is null when cost is hidden or unknown (never invented). Suggested quantity nets out confirmed inbound.
import { computeReorder, type LowStockSeverity, type ReorderConfidence } from './ai-inventory-reorder.core';
import { requireInventoryView, costVisible } from './ai-inventory-access';
import type { AiInventoryContext, ProductStockRow } from './ai-inventory.dto';
import type { InventoryReadPort } from './ai-inventory.port';

export interface LowStockItem {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  sellableAvailable: number;
  reorderLevel: number;
  criticalLevel: number | null;
  confirmedInbound: number;
  projectedAvailable: number;
  severity: LowStockSeverity;
  vendorName: string | null;
  leadTimeDays: number | null;
  daysOfSupply: number | null;      // null until forecast slice
  predictedStockoutDate: string | null; // null until forecast slice
  updatedAt: string | null;
}

export interface ReorderRecommendation {
  productId: string;
  name: string;
  sku: string | null;
  vendorName: string | null;
  leadTimeDays: number | null;
  sellableAvailable: number;
  confirmedInbound: number;
  reorderLevel: number;
  reorderQuantity: number;
  safetyStock: number | null;     // not modelled yet → null (data-quality note)
  targetStock: number;
  suggestedQuantity: number;
  estimatedCostCents: number | null; // null when cost hidden/unknown
  coveredByInbound: boolean;
  confidence: ReorderConfidence;
  usesStaticReorderPoint: boolean;
  reason: string;                 // concise §61 evidence
  dataQualityNotes: string[];
}

const MAX = 500;

export class AiInventoryReorderService {
  constructor(private readonly read: InventoryReadPort) {}

  private evaluate(row: ProductStockRow) {
    const sellableAvailable = Math.max(0, row.onHand - row.reserved);
    const r = computeReorder({
      sellableAvailable, confirmedInbound: row.confirmedInbound,
      reorderLevel: row.reorderLevel, reorderQuantity: row.reorderQuantity,
      criticalLevel: row.criticalLevel, safetyStock: null, // not in schema
      leadTimeDays: row.vendorLeadTimeDays, avgDailyUsage: null, // forecast slice
    });
    return { sellableAvailable, r };
  }

  /** Products at/below their reorder point (§16). Read-only. Days-of-supply/stockout-date are null until forecasting. */
  async getLowStock(ctx: AiInventoryContext): Promise<{ branchId: string; items: LowStockItem[] }> {
    requireInventoryView(ctx);
    const rows = await this.read.listProductStock(ctx.tenantId, ctx.branchId, { limit: MAX });
    const items: LowStockItem[] = [];
    for (const row of rows) {
      const { sellableAvailable, r } = this.evaluate(row);
      if (r.severity === 'none') continue;
      items.push({
        productId: row.productId, name: row.name, sku: row.sku, categoryName: row.categoryName,
        sellableAvailable, reorderLevel: row.reorderLevel, criticalLevel: row.criticalLevel,
        confirmedInbound: row.confirmedInbound, projectedAvailable: r.projectedAvailable, severity: r.severity,
        vendorName: row.vendorName, leadTimeDays: row.vendorLeadTimeDays,
        daysOfSupply: null, predictedStockoutDate: null, updatedAt: row.updatedAt,
      });
    }
    // Worst first: out_of_stock → critical → low.
    const rank: Record<LowStockSeverity, number> = { out_of_stock: 3, critical: 2, low: 1, none: 0 };
    items.sort((a, b) => rank[b.severity] - rank[a.severity] || a.sellableAvailable - b.sellableAvailable);
    return { branchId: ctx.branchId, items };
  }

  /** Reorder recommendation cards for products that need ordering after netting out inbound (§17–§18). Read-only. */
  async getReorderRecommendations(ctx: AiInventoryContext): Promise<{ branchId: string; costVisible: boolean; recommendations: ReorderRecommendation[] }> {
    requireInventoryView(ctx);
    const showCost = costVisible(ctx);
    const rows = await this.read.listProductStock(ctx.tenantId, ctx.branchId, { limit: MAX });
    const recs: ReorderRecommendation[] = [];
    for (const row of rows) {
      const { sellableAvailable, r } = this.evaluate(row);
      if (!r.belowReorderPoint || r.suggestedQuantity <= 0) continue; // only actionable reorders (inbound-covered excluded)

      const notes: string[] = [];
      if (row.reorderQuantity <= 0) notes.push('No configured reorder quantity — suggesting the raw need; set a case-pack/batch size for accurate rounding.');
      notes.push('Safety stock is not configured in the catalog — recommendation uses the static reorder point only.');
      if (row.vendorLeadTimeDays == null) notes.push('Preferred vendor lead time unknown — cannot project a stockout date yet.');
      notes.push('Forecast-driven usage is not yet available — this is a static-reorder-point recommendation (low confidence).');

      const estimatedCostCents = showCost && row.costCents != null ? row.costCents * r.suggestedQuantity : null;
      const reason =
        `Available ${sellableAvailable} ≤ reorder point ${row.reorderLevel}; ` +
        `confirmed inbound ${row.confirmedInbound}; ` +
        `${row.vendorLeadTimeDays != null ? `vendor lead time ${row.vendorLeadTimeDays}d; ` : ''}` +
        `suggested order ${r.suggestedQuantity}.`;

      recs.push({
        productId: row.productId, name: row.name, sku: row.sku,
        vendorName: row.vendorName, leadTimeDays: row.vendorLeadTimeDays,
        sellableAvailable, confirmedInbound: row.confirmedInbound,
        reorderLevel: row.reorderLevel, reorderQuantity: row.reorderQuantity, safetyStock: null,
        targetStock: r.targetStock, suggestedQuantity: r.suggestedQuantity, estimatedCostCents,
        coveredByInbound: r.coveredByInbound, confidence: r.confidence, usesStaticReorderPoint: r.usesStaticReorderPoint,
        reason, dataQualityNotes: notes,
      });
    }
    // Most urgent first: lowest available, then largest suggested order.
    recs.sort((a, b) => a.sellableAvailable - b.sellableAvailable || b.suggestedQuantity - a.suggestedQuantity);
    return { branchId: ctx.branchId, costVisible: showCost, recommendations: recs };
  }
}
