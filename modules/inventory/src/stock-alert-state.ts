// stock-alert-state.ts — Stock Alerts mandate (Oct 29 2026): THE one definition of "a product that needs attention at this
// location". Before, the sidebar counted products whose base reorder level was reached (inner join, overrides ignored), the
// Stock Alerts page counted persisted alert rows (written only when a product CROSSED a threshold — a product already low
// when it was set up never got one, so the sidebar said 11 and the page said 0), and a third live endpoint went unused.
// Now every surface reads this fragment: per ACTIVE, un-archived product × this branch, the branch's overrides applied,
// a product with no stock row counting 0 on hand, a product with no reorder level never alerting, severity exactly as
// stockStatus() (out ≤ 0; critical ≤ critical level, else ceil(reorder / 2); low ≤ reorder).
// The persisted inventory_alerts rows keep the WORKFLOW (when it started, who acknowledged it, when it resolved), joined
// on top of this state by the Stock Alerts read model — never the count.
import { sql, type RawBuilder } from 'kysely';

export type LiveSeverity = 'out_of_stock' | 'critical' | 'low';
export interface LiveAlertRow {
  product_id: string; on_hand: number; reorder_level: number; critical_level: number; reorder_quantity: number; maximum_stock: number | null;
  severity: LiveSeverity; preferred_vendor_id: string | null;
}

/** The live alert set as a sub-select (alias it: `FROM (${liveAlertState(t, b)}) la`). */
export function liveAlertState(tenantId: string, branchId: string): RawBuilder<LiveAlertRow> {
  return sql<LiveAlertRow>`SELECT x.product_id, x.on_hand, x.reorder_level, x.critical_level, x.reorder_quantity, x.maximum_stock, x.preferred_vendor_id,
      CASE WHEN x.on_hand <= 0 THEN 'out_of_stock' WHEN x.critical_level > 0 AND x.on_hand <= x.critical_level THEN 'critical' ELSE 'low' END AS severity
    FROM (
      SELECT p.id AS product_id,
             coalesce(s.quantity_on_hand, 0)::int AS on_hand,
             coalesce(s.reorder_level_override, p.reorder_level, 0)::int AS reorder_level,
             CASE WHEN coalesce(s.critical_level_override, p.critical_level, 0) > 0 THEN coalesce(s.critical_level_override, p.critical_level)::int
                  ELSE ceil(coalesce(s.reorder_level_override, p.reorder_level, 0) / 2.0)::int END AS critical_level,
             coalesce(s.reorder_quantity_override, p.reorder_quantity, 0)::int AS reorder_quantity,
             p.maximum_stock,
             coalesce(s.preferred_vendor_id_override, p.preferred_vendor_id) AS preferred_vendor_id
        FROM inventory_products p
        LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${branchId}
       WHERE p.tenant_id = ${tenantId} AND p.active = true AND p.archived_at IS NULL
    ) x
    WHERE x.reorder_level > 0 AND x.on_hand <= x.reorder_level`;
}

/** The sidebar badge and the page's Open Alerts KPI: live alerts not acknowledged in their current episode. */
export function openAlertCount(tenantId: string, branchId: string): RawBuilder<{ n: number }> {
  return sql<{ n: number }>`SELECT count(*)::int AS n FROM (${liveAlertState(tenantId, branchId)}) la
    WHERE NOT EXISTS (SELECT 1 FROM inventory_alerts a WHERE a.tenant_id = ${tenantId} AND a.branch_id = ${branchId} AND a.product_id = la.product_id
                        AND a.resolved_at IS NULL AND a.acknowledged_at IS NOT NULL)`;
}

/** Purchase-order statuses whose open quantity is really coming: a DRAFT is not an order yet (it was counted as one). */
export const ON_ORDER_PO_STATUSES = ['approved', 'ordered', 'partial'] as const;

/** Bottles (purchase units × pack) still to arrive for `productCol` at `branchId` (every location when null) — committed purchase orders only. */
export function onOrderSql(tenantId: string, branchId: string | null, productCol: RawBuilder<unknown>): RawBuilder<number> {
  return sql<number>`(SELECT coalesce(sum(greatest(0, pl.quantity_ordered - pl.quantity_received) * pl.units_per_purchase_unit), 0)::int FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id
    WHERE po.tenant_id = ${tenantId} AND (${branchId}::uuid IS NULL OR po.branch_id = ${branchId}::uuid) AND pl.product_id = ${productCol} AND po.status IN ('approved', 'ordered', 'partial'))`;
}
