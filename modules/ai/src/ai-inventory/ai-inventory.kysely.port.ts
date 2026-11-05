// ai-inventory.kysely.port.ts — production read port. Reads the AUTHORITATIVE inventory tables the tenant Inventory
// module owns (inventory_products LEFT JOIN inventory_location_stock at the ctx branch), ALWAYS filtered by tenant_id and
// branch_id. Read-only: SELECT only, no writes. expired/quarantined are not columns on inventory_location_stock (they
// live at the unit level and are aggregated in a later slice), so they are reported as 0 here rather than guessed.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { InventoryReadPort, ListStockOptions } from './ai-inventory.port';
import type { ProductStockRow, SlowMovingInputRow } from './ai-inventory.dto';

export class KyselyInventoryRead implements InventoryReadPort {
  constructor(private readonly db: Kysely<DB>) {}

  async listProductStock(tenantId: string, branchId: string, opts: ListStockOptions): Promise<ProductStockRow[]> {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
    const rows = await sql<any>`
      SELECT p.id AS product_id, p.name, p.sku, p.unit_type,
             p.reorder_level, p.reorder_quantity, p.critical_level, p.maximum_stock,
             p.cost_cents, p.retail_price_cents,
             p.preferred_vendor_id,
             v.name AS vendor_name, v.lead_time_days AS vendor_lead_time_days,
             c.name AS category_name,
             COALESCE(s.quantity_on_hand, 0)   AS on_hand,
             COALESCE(s.quantity_reserved, 0)  AS reserved,
             COALESCE(s.quantity_damaged, 0)   AS damaged,
             s.updated_at,
             -- confirmed inbound: open PO lines (approved|ordered|partial) not yet received, this tenant+branch
             COALESCE((
               SELECT SUM(GREATEST(l.quantity_ordered - l.quantity_received, 0))
               FROM purchase_order_lines l
               JOIN purchase_orders po ON po.id = l.purchase_order_id
               WHERE l.tenant_id = p.tenant_id AND l.product_id = p.id
                 AND po.tenant_id = p.tenant_id AND po.branch_id = ${branchId}
                 AND po.status IN ('approved','ordered','partial')
             ), 0) AS confirmed_inbound
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s
        ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${branchId}
      LEFT JOIN inventory_categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      LEFT JOIN inventory_vendors v ON v.id = p.preferred_vendor_id AND v.tenant_id = p.tenant_id
      WHERE p.tenant_id = ${tenantId}
        AND p.archived_at IS NULL
        AND (${opts.productId ?? null}::uuid IS NULL OR p.id = ${opts.productId ?? null})
        AND (${opts.categoryId ?? null}::uuid IS NULL OR p.category_id = ${opts.categoryId ?? null})
      ORDER BY p.name
      LIMIT ${limit}
    `.execute(this.db);

    return rows.rows.map((r): ProductStockRow => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku ?? null,
      categoryName: r.category_name ?? null,
      inventoryType: r.unit_type ?? null,
      onHand: Number(r.on_hand ?? 0),
      reserved: Number(r.reserved ?? 0),
      damaged: Number(r.damaged ?? 0),
      expired: 0,      // not aggregated at location level yet (unit-level; later slice)
      quarantined: 0,  // not modelled yet
      confirmedInbound: Number(r.confirmed_inbound ?? 0),
      reorderLevel: Number(r.reorder_level ?? 0),
      reorderQuantity: Number(r.reorder_quantity ?? 0),
      criticalLevel: r.critical_level == null ? null : Number(r.critical_level),
      maximumStock: r.maximum_stock == null ? null : Number(r.maximum_stock),
      costCents: r.cost_cents == null ? null : Number(r.cost_cents),
      retailPriceCents: r.retail_price_cents == null ? null : Number(r.retail_price_cents),
      preferredVendorId: r.preferred_vendor_id ?? null,
      vendorName: r.vendor_name ?? null,
      vendorLeadTimeDays: r.vendor_lead_time_days == null ? null : Number(r.vendor_lead_time_days),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    }));
  }

  async listSlowMovingInputs(tenantId: string, branchId: string, windowDays: number, limit: number): Promise<SlowMovingInputRow[]> {
    const win = String(Math.max(1, Math.min(365, windowDays)));
    const lim = Math.min(500, Math.max(1, limit));
    const rows = await sql<any>`
      SELECT p.id AS product_id, p.name, p.sku, p.unit_type, p.cost_cents, p.maximum_stock,
             c.name AS category_name,
             COALESCE(s.quantity_on_hand, 0) AS on_hand,
             EXTRACT(DAY FROM (now() - p.created_at))::int AS age_days,
             EXTRACT(DAY FROM (now() - m.last_retail_sale_at))::int AS days_since_sale,
             EXTRACT(DAY FROM (now() - m.last_usage_at))::int AS days_since_usage,
             m.retail_units, m.consumption_units
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${branchId}
      LEFT JOIN inventory_categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      LEFT JOIN LATERAL (
        SELECT MAX(mv.created_at) FILTER (WHERE mv.movement_type = 'retail_sale')   AS last_retail_sale_at,
               MAX(mv.created_at) FILTER (WHERE mv.movement_type = 'service_usage') AS last_usage_at,
               COALESCE(SUM(-mv.quantity_change) FILTER (WHERE mv.movement_type = 'retail_sale'   AND mv.created_at >= now() - (${win}||' days')::interval), 0) AS retail_units,
               COALESCE(SUM(-mv.quantity_change) FILTER (WHERE mv.movement_type = 'service_usage' AND mv.created_at >= now() - (${win}||' days')::interval), 0) AS consumption_units
        FROM inventory_stock_movements mv
        WHERE mv.tenant_id = p.tenant_id AND mv.branch_id = ${branchId} AND mv.product_id = p.id
      ) m ON true
      WHERE p.tenant_id = ${tenantId} AND p.archived_at IS NULL
      ORDER BY p.name
      LIMIT ${lim}
    `.execute(this.db);

    return rows.rows.map((r): SlowMovingInputRow => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku ?? null,
      categoryName: r.category_name ?? null,
      inventoryType: r.unit_type ?? null,
      onHand: Number(r.on_hand ?? 0),
      costCents: r.cost_cents == null ? null : Number(r.cost_cents),
      maximumStock: r.maximum_stock == null ? null : Number(r.maximum_stock),
      productAgeDays: r.age_days == null ? 0 : Number(r.age_days),
      daysSinceLastSale: r.days_since_sale == null ? null : Number(r.days_since_sale),
      daysSinceLastUsage: r.days_since_usage == null ? null : Number(r.days_since_usage),
      retailUnitsInWindow: Number(r.retail_units ?? 0),
      consumptionUnitsInWindow: Number(r.consumption_units ?? 0),
    }));
  }
}
