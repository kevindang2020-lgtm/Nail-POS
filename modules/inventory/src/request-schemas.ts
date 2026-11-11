// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the inventory module's request-body schemas (catalog records,
// products, stock, purchase orders, transfers, counts, recipes, the receipt expense, technician bottle reports), applied
// with @Body(ValidatedBody(SCHEMA)). Written from InventoryService (every field each method reads — quantities and
// money are Number()-coerced there, so a form's numeric string still passes) and the owner / POS inventory screens.
// Unknown fields are stripped; tenantId / permissions sent where undeclared are refused; a `status` on a purchase order,
// transfer or count body is refused (those move only through their own routes and state machines).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const id: BodySchema = str(64);
const flag: BodySchema = { type: ['boolean', 'null'] };
/** a quantity / cents / days value the service Number()-coerces: a number, or a numeric string from a form field */
const num: BodySchema = { type: ['number', 'string', 'null'], maxLength: 20 };
const NO_STATUS = { 'x-forbidden': ['status'] } as const;
const obj = (props: Record<string, BodySchema>): BodySchema => S.object(props, [], NO_STATUS);
const lines = (item: BodySchema, max = 500): BodySchema => S.nullable(S.array(item, { maxItems: max }));

export const INV_CATEGORY_BODY: BodySchema = S.object({ name: str(120), code: str(32), description: str(1000), displayColor: str(32), parentCategoryId: id, trackingMode: str(32), sortOrder: num });
export const INV_BRAND_BODY: BodySchema = S.object({ name: str(120), code: str(32), notes: str(2000), website: str(500) });
export const INV_VENDOR_BODY: BodySchema = S.object({ name: str(200), contactName: str(200), email: str(254), phone: str(40), website: str(500), accountNumber: str(64), paymentTerms: str(200), leadTimeDays: num,
  // Suppliers & Purchasing (Oct 29 2026): the full profile; confirmDuplicate saves past the same-name / phone / email warning
  tradeName: str(200), supplierCode: str(40), street: str(200), city: str(120), state: str(80), postalCode: str(20), country: str(80), notes: str(4000),
  preferred: flag, minimumOrderCents: num, currency: str(3), confirmDuplicate: flag });
export const INV_VENDOR_CONTACT_BODY: BodySchema = S.object({ name: str(200), role: str(120), mobilePhone: str(40), officePhone: str(40), email: str(254), preferredMethod: str(16), primary: flag, notes: str(2000) });
export const INV_VENDOR_PRODUCT_BODY: BodySchema = S.object({ productId: id, supplierSku: str(64), lastCostCents: num, purchaseUnit: str(32), unitsPerPurchaseUnit: num, minimumOrderQty: num, leadTimeDays: num, preferred: flag });
export const INV_PO_VENDOR_BODY: BodySchema = S.object({ vendorId: id });

const productCamel = {
  name: str(200), productLine: str(200), colorName: str(120), colorNumber: str(64), colorFamily: str(64), finish: str(64),
  sku: str(64), barcode: str(64), upc: str(64), unitType: str(32), trackingMode: str(32), costCents: num, retailPriceCents: num,
  reorderLevel: num, reorderQuantity: num, maximumStock: num, criticalLevel: num, leadTimeDays: num, imageUrl: str(2048),
  buttonColor: str(32), trackExpiration: flag, isRetail: flag, isService: flag, categoryId: id, brandId: id, preferredVendorId: id,
  sizeValue: num, sizeUnit: str(16),
};
/** updateProduct writes a whitelisted column by its camelCase OR its column name — both forms are declared */
const productSnake = {
  product_line: str(200), color_name: str(120), color_number: str(64), color_family: str(64), unit_type: str(32), tracking_mode: str(32),
  cost_cents: num, retail_price_cents: num, reorder_level: num, reorder_quantity: num, maximum_stock: num, critical_level: num,
  lead_time_days: num, image_url: str(2048), button_color: str(32), track_expiration: flag, is_retail: flag, is_service: flag,
  category_id: id, brand_id: id, preferred_vendor_id: id,
};
export const INV_PRODUCT_CREATE_BODY: BodySchema = S.object(productCamel);
export const INV_PRODUCT_UPDATE_BODY: BodySchema = S.object({ ...productCamel, ...productSnake, expectedUpdatedAt: str(64) });   // concurrent-edit guard (optional)
export const INV_STOCK_OVERRIDES_BODY: BodySchema = S.object({
  reorderLevelOverride: num, reorderQuantityOverride: num, criticalLevelOverride: num, leadTimeDaysOverride: num, preferredVendorIdOverride: id, expectedVersion: num,
});
export const INV_ADD_STOCK_BODY: BodySchema = obj({ quantity: num, costCents: num, lotNumber: str(64), expirationDate: str(32), storageLocation: str(200), purchaseOrderId: id, note: str(1000) });
export const INV_NOTE_BODY: BodySchema = obj({ note: str(2000) });
export const INV_PO_CREATE_BODY: BodySchema = obj({
  vendorId: id, expectedDate: str(32), notes: str(2000), shippingCents: num, taxCents: num,
  lines: lines(S.object({ productId: id, quantityOrdered: num, quantity: num, unitCostCents: num })),
});
// D9 gaps (Nov 5 2026): change a draft PO — the supplier stays (pack sizes come from it)
export const INV_PO_UPDATE_BODY: BodySchema = obj({
  expectedDate: str(32), notes: str(2000), shippingCents: num, taxCents: num,
  lines: lines(S.object({ productId: id, quantityOrdered: num, unitCostCents: num })),
});
export const INV_PO_RECEIVE_BODY: BodySchema = obj({ lines: lines(S.object({ lineId: id, quantity: num, damaged: num, lotNumber: str(64), expirationDate: str(32) })) });
export const INV_TRANSFER_BODY: BodySchema = obj({ toBranchId: id, notes: str(2000), ship: S.nullable(S.boolean()), lines: lines(S.object({ productId: id, quantity: num })) });
// D9 gaps (Nov 5 2026): receive a shipped transfer (all, or per product how many arrived) / cancel it while in transit
export const INV_TRANSFER_RECEIVE_BODY: BodySchema = obj({ notes: str(2000), lines: lines(S.object({ productId: id, received: num })) });
export const INV_TRANSFER_CANCEL_BODY: BodySchema = obj({ reason: S.text(500, { minLength: 3 }) });
export const INV_COUNT_CREATE_BODY: BodySchema = obj({ scopeType: str(32), scopeId: id, notes: str(2000) });
export const INV_COUNT_LINES_BODY: BodySchema = obj({ lineId: id, countedQty: num, lines: lines(S.object({ lineId: id, countedQty: num }), 5000) });
export const INV_RECIPE_BODY: BodySchema = S.object({ lines: lines(S.object({ productId: id, quantity: num }), 100) });
export const INV_CONSUME_BODY: BodySchema = S.object({ multiplier: num });
export const INV_RECEIPT_EXPENSE_BODY: BodySchema = S.object({ amountCents: num, category: str(64), description: str(1000), incurredOn: str(32), vendor: str(200) });
export const TECH_INVENTORY_REPORT_BODY: BodySchema = obj({
  reportType: str(32), productId: id, unitId: id, serviceTicketId: id, estimatedRemainingPercent: num, reportedQuantity: num, note: str(1000), photoUrl: str(2048),
});
/** Stock Alerts + Technician Product Usage (Oct 29 2026): one product use (quantity as a decimal string, e.g. "0.5");
 *  technicianId / onBehalfReason only when recording for someone else. A correction is a signed delta with its reason. */
export const INV_PRODUCT_USAGE_BODY: BodySchema = obj({
  productId: id, quantity: num, technicianId: id, occurredAt: str(40), unitId: id, serviceTicketId: id, note: str(1000), onBehalfReason: str(500), source: str(20),
});
export const INV_PRODUCT_USAGE_ADJUST_BODY: BodySchema = obj({ delta: num, reason: str(500) });
export const INV_ALERT_ACK_BODY: BodySchema = obj({ note: str(500) });
