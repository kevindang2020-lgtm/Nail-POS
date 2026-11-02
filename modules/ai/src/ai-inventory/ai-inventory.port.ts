// ai-inventory.port.ts — the read boundary the AI Inventory analysis layer depends on. The Kysely implementation
// (ai-inventory.kysely.port.ts) reads the AUTHORITATIVE inventory tables (inventory_location_stock / inventory_products),
// always tenant+branch scoped. The in-memory fake mirrors that contract for unit tests. The analysis services never
// touch the DB directly and never mutate — this port is READ-ONLY by construction (no write methods exist).
import type { ProductStockRow, SlowMovingInputRow } from './ai-inventory.dto';

export interface ListStockOptions {
  productId?: string | null;
  categoryId?: string | null;
  limit?: number;
}

export interface InventoryReadPort {
  /** Authoritative per-product stock at the ctx branch. MUST filter by tenantId + branchId. */
  listProductStock(tenantId: string, branchId: string, opts: ListStockOptions): Promise<ProductStockRow[]>;
  /** Stock + movement velocity for slow-moving analysis over a window. MUST filter by tenantId + branchId. */
  listSlowMovingInputs(tenantId: string, branchId: string, windowDays: number, limit: number): Promise<SlowMovingInputRow[]>;
}

/** Deterministic in-memory port for tests. Keyed by tenant→branch→rows so cross-tenant/branch isolation is exercised. */
export class InMemoryInventoryRead implements InventoryReadPort {
  constructor(
    private data: Record<string, Record<string, ProductStockRow[]>> = {},
    private slowData: Record<string, Record<string, SlowMovingInputRow[]>> = {},
  ) {}

  seed(tenantId: string, branchId: string, rows: ProductStockRow[]) {
    (this.data[tenantId] ??= {})[branchId] = rows;
  }

  seedSlowMoving(tenantId: string, branchId: string, rows: SlowMovingInputRow[]) {
    (this.slowData[tenantId] ??= {})[branchId] = rows;
  }

  async listProductStock(tenantId: string, branchId: string, opts: ListStockOptions): Promise<ProductStockRow[]> {
    let rows = this.data[tenantId]?.[branchId] ?? [];
    if (opts.productId) rows = rows.filter((r) => r.productId === opts.productId);
    if (opts.limit && opts.limit > 0) rows = rows.slice(0, opts.limit);
    // Return copies so callers cannot mutate the seeded fixtures (mirrors DB read semantics).
    return rows.map((r) => ({ ...r }));
  }

  async listSlowMovingInputs(tenantId: string, branchId: string, _windowDays: number, limit: number): Promise<SlowMovingInputRow[]> {
    let rows = this.slowData[tenantId]?.[branchId] ?? [];
    if (limit && limit > 0) rows = rows.slice(0, limit);
    return rows.map((r) => ({ ...r }));
  }
}
