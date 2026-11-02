// ai-inventory-position.service.ts — slice 1 read-only backbone of the AI Inventory Assistant.
// Turns authoritative branch stock (via InventoryReadPort) into the §10 inventory POSITION per product, plus a branch
// context summary. It NEVER mutates stock and NEVER invents numbers: inbound/in-transit are marked not-yet-wired
// (inboundKnown:false) until the procurement-read slice, so the UI shows “—” rather than a fabricated zero. Cost fields
// are stripped for roles without ai_inventory.view_cost / inventory.cost.view (technicians never see cost).
import { computePosition } from './ai-inventory-core';
import { requireInventoryView, costVisible } from './ai-inventory-access';
import {
  AiInventoryError, AiInventoryErrorCode,
  type AiInventoryContext, type InventoryContextSummary, type ProductPosition, type ProductStockRow,
} from './ai-inventory.dto';
import type { InventoryReadPort, ListStockOptions } from './ai-inventory.port';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export class AiInventoryPositionService {
  constructor(private readonly read: InventoryReadPort) {}

  private toPosition(row: ProductStockRow, costVisible: boolean): ProductPosition {
    const position = computePosition({
      onHand: row.onHand, reserved: row.reserved, damaged: row.damaged, expired: row.expired, quarantined: row.quarantined,
      // Confirmed inbound = open PO qty (approved|ordered|partial) not yet received. In-transit is structurally 0:
      // the tenant transfer domain is an IMMEDIATE model (units reassigned at creation, no shipped-but-not-received
      // state), so there is nothing in transit to count — inboundKnown is therefore genuinely true.
      confirmedInbound: row.confirmedInbound, inTransitInbound: 0, inTransitOutbound: 0, inboundKnown: true,
      reorderLevel: row.reorderLevel, reorderQuantity: row.reorderQuantity,
      criticalLevel: row.criticalLevel, maximumStock: row.maximumStock,
      // Usage/forecast arrives in a later slice — null keeps days-of-supply honest (“—”).
      avgDailyUsage: null, usageHistoryDays: 0,
    });
    return {
      productId: row.productId, name: row.name, sku: row.sku, categoryName: row.categoryName,
      inventoryType: row.inventoryType, position,
      costCents: costVisible ? row.costCents : null,
      retailPriceCents: costVisible ? row.retailPriceCents : null,
      updatedAt: row.updatedAt,
    };
  }

  /** Positions for products at the ctx branch (optionally one product / one category). Read-only. */
  async getPositions(ctx: AiInventoryContext, opts: ListStockOptions = {}): Promise<{ branchId: string; costVisible: boolean; inboundWired: boolean; positions: ProductPosition[] }> {
    requireInventoryView(ctx);
    const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const rows = await this.read.listProductStock(ctx.tenantId, ctx.branchId, { ...opts, limit });
    const showCost = costVisible(ctx);
    return { branchId: ctx.branchId, costVisible: showCost, inboundWired: true, positions: rows.map((r) => this.toPosition(r, showCost)) };
  }

  /** Position for a single product; 404 when absent at this branch. */
  async getProductPosition(ctx: AiInventoryContext, productId: string): Promise<ProductPosition> {
    requireInventoryView(ctx);
    if (!productId) throw new AiInventoryError(AiInventoryErrorCode.PRODUCT_NOT_FOUND, 'productId required', 404);
    const rows = await this.read.listProductStock(ctx.tenantId, ctx.branchId, { productId, limit: 1 });
    if (rows.length === 0) throw withCode(new AiInventoryError(AiInventoryErrorCode.INVENTORY_NOT_FOUND, 'No stock record for this product at this branch', 404), 'NO_STOCK_RECORD');
    return this.toPosition(rows[0], costVisible(ctx));
  }

  /** Branch context summary — counts by stock status. Read-only; costs never leak here. */
  async getContext(ctx: AiInventoryContext): Promise<InventoryContextSummary> {
    requireInventoryView(ctx);
    const rows = await this.read.listProductStock(ctx.tenantId, ctx.branchId, { limit: MAX_LIMIT });
    const showCost = costVisible(ctx);
    let inStock = 0, low = 0, critical = 0, outOfStock = 0, overstock = 0;
    for (const r of rows) {
      const s = this.toPosition(r, false).position.status;
      if (s === 'in_stock') inStock++;
      else if (s === 'low') low++;
      else if (s === 'critical') critical++;
      else if (s === 'out_of_stock') outOfStock++;
      else if (s === 'overstock') overstock++;
    }
    return {
      tenantId: ctx.tenantId, branchId: ctx.branchId, productCount: rows.length,
      inStock, low, critical, outOfStock, overstock,
      costVisible: showCost, inboundWired: true, generatedAt: new Date().toISOString(),
    };
  }
}
