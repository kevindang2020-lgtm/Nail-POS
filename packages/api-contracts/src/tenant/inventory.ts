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

// ── Extras · ADD-ONS 09 — Service profitability context (GET /pos/menu-insights/add-on-profitability, inventory.cost.view).
//    Sold add-ons on PAID tickets in the salon-local window (a fully refunded or voided ticket is left out) and the recipe
//    cost of what was sold: units × THE recipe unit cost (recipeUnitCosts — Σ recipe quantity × the product's own cost, or
//    its location average; TODAY's costs). Contribution = revenue − recipe cost, before commission, tax and labor. An
//    add-on with no recipe has recipeCostCents null ("—"), never 0. Read only. Integer cents.
export interface AddOnProfitabilityItem {
  key: string; serviceId: string | null; name: string; unitsSold: number; ticketCount: number; revenueCents: number;
  recipeUnitCostCents: number | null; recipeCostCents: number | null; contributionCents: number | null;
}
export interface AddOnProfitabilityResponse {
  window: { days: number; from: string; timeZone: string };
  basis: { revenue: 'paid_tickets_line_totals'; cost: 'recipe_at_current_product_cost'; excludes: ['commission', 'tax', 'labor', 'refunded_or_voided_tickets'] };
  totals: { unitsSold: number; revenueCents: number; costedRevenueCents: number; recipeCostCents: number; contributionCents: number; addOnsWithoutRecipe: number };
  items: AddOnProfitabilityItem[]; page: number; pageSize: number; totalItems: number; totalPages: number;
}

// ── Extras · Products Management 07 (round 10) — Duplicate product warning (GET tenant/inventory/products/duplicates,
//    inventory.view). Read only: the live products a NEW (or edited) product may duplicate, each with WHY. An exact SKU /
//    barcode is still refused by the server on save (PRODUCT_SKU_TAKEN / PRODUCT_BARCODE_TAKEN); the near matches here are
//    warnings for a person to review (same SKU ignoring case / spaces / dashes, a supplier SKU another product is already
//    linked under, the same name + size). Archived products are never listed.
export type InventoryDuplicateReason = 'sku_exact' | 'sku_near' | 'barcode' | 'supplier_sku' | 'name_size';
export interface InventoryDuplicateCandidate { productId: string; name: string; sku: string | null; barcode: string | null; reasons: InventoryDuplicateReason[]; supplierSku: string | null; supplierName: string | null }
export interface InventoryProductDuplicatesResponse { candidates: InventoryDuplicateCandidate[]; checked: { sku: boolean; barcode: boolean; supplierSku: boolean; name: boolean } }

// ── Extras · Products Management 09 (round 10) — Stock status preview before Add Stock (GET tenant/inventory/products/:id/
//    stock-preview?quantity=n, inventory.view). Read only, for THIS location (the session's branch) and the product's unit:
//    on hand now, still to arrive on committed purchase orders (approved / ordered / partial), after this receipt, after this
//    receipt + what is coming, the location's effective reorder / critical levels (overrides applied) and the stock status of
//    each — from THE stock status rule (stockStatus). Nothing is written.
export type InventoryStockStatusCode = 'in_stock' | 'low' | 'critical' | 'out_of_stock' | 'overstock';
export interface InventoryStockPreviewResponse {
  productId: string; branch: { id: string; name: string | null }; unit: string; quantity: number;
  onHand: number; incoming: number; afterAdd: number; afterAddAndIncoming: number;
  reorderLevel: number; criticalLevel: number; maximumStock: number | null;
  statusNow: InventoryStockStatusCode; statusAfter: InventoryStockStatusCode; statusAfterIncoming: InventoryStockStatusCode;
  /** this receipt alone lifts the location above its reorder level */ clearsReorder: boolean;
  /** after this receipt the location is above its maximum stock */ overMaximum: boolean;
}

// ── Extras · Products Management 14 (round 10) — Controlled low-stock reorder (GET tenant/inventory/products/:id/reorder-draft,
//    inventory.purchase_order.create). Read only: what a Reorder DRAFT purchase order is prefilled with for THIS location —
//    the suggestion from THE reorder rule (reorderSuggestion: what is already on committed orders is subtracted) and, when the
//    product has an ACTIVE supplier mapping (inventory_vendor_products, active supplier — the product's preferred supplier
//    first, then the preferred link), that supplier, its SKU, last cost and pack size; the quantity to order is in the
//    supplier's purchase units (packs, at least the minimum order). mapping null = no verified mapping: nothing is guessed.
//    Nothing is created here; the draft is created and then approved by a person.
export interface InventoryReorderMapping { vendorId: string; vendorName: string; supplierSku: string | null; unitCostCents: number | null; purchaseUnit: string | null; unitsPerPurchaseUnit: number; minimumOrderQty: number | null; leadTimeDays: number | null }
export interface InventoryReorderDraftResponse {
  productId: string; productName: string; branchId: string; unit: string;
  onHand: number; onOrder: number; reorderLevel: number; reorderQuantity: number; suggestedUnits: number;
  mapping: InventoryReorderMapping | null;
  /** purchase units (packs) to put on the draft line — 0 when nothing is suggested */ purchaseUnitsToOrder: number;
  /** bottles / units that order brings in (packs × pack size) */ unitsThatArrive: number;
}

// round 11 — extras ADD-ONS MANAGEMENT 06: add-on recipes (a mechanism, OFF until the salon turns it on)
/** GET / PUT /tenant/inventory/add-on-recipe-settings — whether Service Done deducts add-on recipes (absent = off). */
export interface InventoryAddOnRecipeSettingResponse { enabled: boolean; updatedAt: string | null }
/** GET / PUT /tenant/inventory/add-on-recipes/:key — one add-on's recipe (whole quantities) and whether it is deducted. */
export interface InventoryAddOnRecipeResponse {
  key: string; name: string; deductsAtServiceDone: boolean;
  lines: { productId: string; productName: string; quantity: number; unit: string | null }[];
}
