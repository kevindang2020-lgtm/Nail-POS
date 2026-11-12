// inventory.ts — wire contract (Constitution 13 §13, §15). Realm: tenant.

/** One product line of a service's recipe, as GET /tenant/inventory/recipes/:serviceId returns it (snake_case: the rows
 *  come straight from the query). A different concept from the AI inventory module's RecipeLine (expected consumption). */
export interface ServiceRecipeLine { id: string; product_id: string; product_name: string; color_number: string | null; quantity: number; cost_cents: number | null }
export interface ServiceRecipe { service: { id: string; name: string }; lines: ServiceRecipeLine[]; recipeCostCents: number }

/** Low-Stock Cause Explanation (Extras · Stock Alerts 12): the measured movements behind a product's stock level */
export interface InventoryLowStockCause {
  product: { id: string; name: string; onHand: number; reorderLevel: number; low: boolean };
  days: number;
  buckets: { usage: number; received: number; losses: number; corrections: number; other: number };   // signed unit totals in the window
  byType: { type: string; change: number; count: number }[];
  lastReceivedAt: string | null;
  openOrders: { quantity: number; orders: number; expectedDate: string | null; overdue: boolean };
  ledgerAfter: number | null;     // quantity_after of the latest movement (null = no movement on record)
  consistent: boolean | null;     // ledger agrees with on-hand (null = nothing to compare)
  causes: ('usage' | 'losses' | 'no_receiving' | 'receiving_delayed' | 'corrections' | 'inconsistent' | 'no_movements')[];
  /** Reorder & Receiving Reconciliation (Extras · Stock Alerts 06): the suggestion vs what is on order and what arrived */
  reorder: { reorderQuantity: number; onOrder: number; suggested: number; partlyReceivedLines: number; receivedInWindow: number; lastReceiptQuantity: number | null };
}
