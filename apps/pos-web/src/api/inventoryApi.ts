// inventoryApi.ts — tenant Inventory client (Services & Products → Inventory). Tenant + branch are
// derived server-side from the session; the client never sends them.
import type { ServiceRecipe, ServiceRecipeLine } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
import { api } from './client';

export interface InvSummary {
  totalProducts: number; totalBottles: number; openBottles: number; unopenedBottles: number;
  lowStock: number; outOfStock: number; expiringSoon: number; pendingReports: number; inventoryValueCents?: number;
}
export interface InvProduct {
  id: string; name: string; brand_name?: string | null; category_name?: string | null;
  color_name?: string | null; color_number?: string | null; finish?: string | null; sku?: string | null;
  barcode?: string | null; upc?: string | null; image_url?: string | null; button_color?: string | null;
  onHand: number; quantity_unopened?: number; quantity_open?: number; quantity_empty?: number; quantity_damaged?: number;
  reorder_level?: number; reorder_quantity?: number; maximum_stock?: number | null; critical_level?: number | null; cost_cents?: number | null; retail_price_cents?: number | null;
  reorder_level_override?: number | null; reorder_quantity_override?: number | null; critical_level_override?: number | null; lead_time_days_override?: number | null; preferred_vendor_id_override?: string | null; lead_time_days?: number | null; preferred_vendor_id?: string | null;
  status: 'in_stock' | 'low' | 'critical' | 'out_of_stock' | 'overstock'; reorderSuggestion: number; tracking_mode?: string;
}
export interface InvUnit { id: string; status: string; lot_number?: string | null; expiration_date?: string | null; internal_barcode?: string | null; storage_location?: string | null }
export interface TechReport { id: string; product_name: string; color_number?: string | null; report_type: string; status: string; note?: string | null; created_at: string }
export interface InvVendor { id: string; name: string; contact_name?: string | null; phone?: string | null; email?: string | null; website?: string | null; account_number?: string | null; payment_terms?: string | null; lead_time_days?: number | null }
export interface InvCategory { id: string; name: string; code?: string | null; description?: string | null; display_color?: string | null; sort_order: number; tracking_mode: 'quantity' | 'bottle'; active: boolean }
export interface InvBrand { id: string; name: string; code?: string | null; website?: string | null; notes?: string | null; active: boolean }
export interface PurchaseOrderSummary {
  id: string; po_number?: string | null; status: string; vendor_name?: string | null; expected_date?: string | null;
  subtotal_cents?: number; shipping_cents?: number; tax_cents?: number; total_cents?: number;
  line_count: number; qty_ordered: number; qty_received: number; created_at: string; approved_at?: string | null; received_at?: string | null;
}
export interface PurchaseOrderLine {
  id: string; product_id: string; product_name: string; color_number?: string | null;
  quantity_ordered: number; quantity_received: number; quantity_damaged_units?: number; unit_cost_cents?: number; lot_number?: string | null; expiration_date?: string | null;
}
export interface PurchaseOrderDetail { purchaseOrder: any; lines: PurchaseOrderLine[] }
export interface TransferBranch { id: string; name: string; city?: string | null; state?: string | null }
export interface TransferSummary {
  id: string; transfer_number?: string | null; status: string; from_branch_id: string; to_branch_id: string;
  from_branch_name?: string | null; to_branch_name?: string | null; item_count: number; unit_count: number;
  notes?: string | null; created_at: string; outbound: boolean;
}
export interface TransferLine { id: string; product_id: string; product_name: string; color_number?: string | null; quantity_requested: number; quantity_moved: number; quantity_received?: number | null }
export interface TransferDetail { transfer: any; lines: TransferLine[] }

export type CountSummary = { id: string; count_number: string; status: 'in_progress' | 'submitted' | 'reconciled' | 'cancelled'; scope_type: 'all' | 'category' | 'brand'; scope_id: string | null; scope_label: string; notes: string | null; line_count: number; counted_count: number; variance_units: number; created_at: string; reconciled_at: string | null };
export type CountLine = { id: string; product_id: string; product_name: string; color_number: string | null; expected_qty: number; counted_qty: number | null; is_counted: boolean };
export type CountDetail = { count: CountSummary; lines: CountLine[] };

export type RecipeServiceSummary = { id: string; name: string; price_cents: number; recipe_lines: number; recipe_units: number };

export type StockAlert = { id: string; product_id: string; product_name: string; color_number: string | null; status: 'low' | 'critical' | 'out_of_stock'; on_hand: number; created_at: string; acknowledged_at: string | null };

export const inventoryApi = {
  summary: () => api.get<{ summary: InvSummary }>('/tenant/inventory/summary'),
  alerts: () => api.get<{ alerts: any[] }>('/tenant/inventory/alerts'),
  categories: () => api.get<{ categories: InvCategory[] }>('/tenant/inventory/categories'),
  brands: () => api.get<{ brands: InvBrand[] }>('/tenant/inventory/brands'),
  createCategory: (b: any) => api.post<{ id: string }>('/tenant/inventory/categories', b),
  createBrand: (b: any) => api.post<{ id: string }>('/tenant/inventory/brands', b),
  updateCategory: (id: string, b: any) => api.patch<{ id: string }>(`/tenant/inventory/categories/${id}`, b),
  archiveCategory: (id: string) => api.post<{ ok: boolean; productsAffected: number }>(`/tenant/inventory/categories/${id}/archive`, {}),
  updateBrand: (id: string, b: any) => api.patch<{ id: string }>(`/tenant/inventory/brands/${id}`, b),
  archiveBrand: (id: string) => api.post<{ ok: boolean; productsAffected: number }>(`/tenant/inventory/brands/${id}/archive`, {}),
  updateVendor: (id: string, b: any) => api.patch<{ id: string }>(`/tenant/inventory/vendors/${id}`, b),
  archiveVendor: (id: string) => api.post<{ ok: boolean }>(`/tenant/inventory/vendors/${id}/archive`, {}),
  products: (q?: Record<string, unknown>) => api.get<{ products: InvProduct[] }>('/tenant/inventory/products', q),
  updateProduct: (id: string, b: any) => api.patch<{ product: InvProduct }>(`/tenant/inventory/products/${id}`, b),
  setStockOverrides: (id: string, b: any) => api.patch<{ product: InvProduct }>(`/tenant/inventory/products/${id}/stock-overrides`, b),
  product: (id: string) => api.get<{ product: any; units: InvUnit[] }>(`/tenant/inventory/products/${id}`),
  createProduct: (b: any) => api.post<{ id: string }>('/tenant/inventory/products', b),
  /** Products Management 07: the live products a new / edited product may duplicate, and why (read only) */
  productDuplicates: (q: Record<string, unknown>) => api.get<InvDuplicatesResult>('/tenant/inventory/products/duplicates', q),
  addStock: (id: string, b: any) => api.post<{ product: any }>(`/tenant/inventory/products/${id}/stock/add`, b),
  /** Products Management 09: current / incoming / after / threshold impact before Add Stock (read only, server-computed) */
  stockPreview: (id: string, quantity: number) => api.get<InvStockPreview>(`/tenant/inventory/products/${id}/stock-preview`, { quantity }),
  openUnit: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/open`, {}),
  markEmpty: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/mark-empty`, {}),
  markLow: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/mark-low`, {}),
  markDamaged: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/mark-damaged`, {}),
  markExpired: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/mark-expired`, {}),
  markMissing: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/mark-missing`, {}),
  markFound: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/found`, {}),
  dispose: (unitId: string) => api.post(`/tenant/inventory/units/${unitId}/dispose`, {}),
  reports: (status = 'pending') => api.get<{ reports: TechReport[] }>('/tenant/inventory/technician-reports', { status }),
  approveReport: (id: string) => api.post(`/tenant/inventory/technician-reports/${id}/approve`, {}),
  rejectReport: (id: string) => api.post(`/tenant/inventory/technician-reports/${id}/reject`, {}),
  vendors: () => api.get<{ vendors: InvVendor[] }>('/tenant/inventory/vendors'),
  createVendor: (b: any) => api.post<{ id: string }>('/tenant/inventory/vendors', b),
  purchaseOrders: (status?: string) => api.get<{ purchaseOrders: PurchaseOrderSummary[] }>('/tenant/inventory/purchase-orders', status ? { status } : undefined),
  purchaseOrder: (id: string) => api.get<PurchaseOrderDetail>(`/tenant/inventory/purchase-orders/${id}`),
  updatePurchaseOrder: (id: string, b: any) => api.patch<PurchaseOrderDetail>(`/tenant/inventory/purchase-orders/${id}`, b),   // D9 gaps: change a draft
  /** Products Management 14: the Reorder draft prefill from the verified supplier mapping (read only, server-computed) */
  reorderDraft: (productId: string) => api.get<InvReorderDraft>(`/tenant/inventory/products/${productId}/reorder-draft`),
  createPurchaseOrder: (b: any, idempotencyKey?: string) => api.post<{ id: string; poNumber: string }>('/tenant/inventory/purchase-orders', b, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  approvePurchaseOrder: (id: string) => api.post<PurchaseOrderDetail>(`/tenant/inventory/purchase-orders/${id}/approve`, {}),
  receivePurchaseOrder: (id: string, b: any, idempotencyKey?: string) => api.post<PurchaseOrderDetail>(`/tenant/inventory/purchase-orders/${id}/receive`, b, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  cancelPurchaseOrder: (id: string) => api.post(`/tenant/inventory/purchase-orders/${id}/cancel`, {}),
  transferBranches: () => api.get<{ branches: TransferBranch[] }>('/tenant/inventory/transfers/branches'),
  transfers: () => api.get<{ transfers: TransferSummary[] }>('/tenant/inventory/transfers'),
  transfer: (id: string) => api.get<TransferDetail>(`/tenant/inventory/transfers/${id}`),
  createTransfer: (b: any) => api.post<TransferDetail>('/tenant/inventory/transfers', b),
  // D9 gaps (Nov 5 2026): receive a shipped transfer (all, or per product how many arrived) / cancel it while in transit
  receiveTransfer: (id: string, b: { lines?: { productId: string; received: number }[]; notes?: string }) => api.post<TransferDetail>(`/tenant/inventory/transfers/${id}/receive`, b as Record<string, unknown>),
  cancelTransfer: (id: string, reason: string) => api.post<TransferDetail>(`/tenant/inventory/transfers/${id}/cancel`, { reason }),
  counts: (status?: string) => api.get<{ counts: CountSummary[] }>('/tenant/inventory/counts', status ? { status } : undefined),
  count: (id: string) => api.get<CountDetail>(`/tenant/inventory/counts/${id}`),
  createCount: (b: any) => api.post<{ id: string; countNumber: string }>('/tenant/inventory/counts', b),
  enterCount: (id: string, b: any) => api.post<CountDetail>(`/tenant/inventory/counts/${id}/lines`, b),
  submitCount: (id: string) => api.post<CountDetail>(`/tenant/inventory/counts/${id}/submit`, {}),
  reconcileCount: (id: string) => api.post<CountDetail>(`/tenant/inventory/counts/${id}/reconcile`, {}),
  cancelCount: (id: string) => api.post(`/tenant/inventory/counts/${id}/cancel`, {}),
  serviceRecipe: (serviceId: string) => api.get<ServiceRecipe>(`/tenant/inventory/recipes/${serviceId}`),
  setServiceRecipe: (serviceId: string, lines: { productId: string; quantity: number }[]) => api.put<ServiceRecipe>(`/tenant/inventory/recipes/${serviceId}`, { lines }),
  acknowledgeAlert: (id: string) => api.post<{ ok: boolean }>(`/tenant/inventory/alert-feed/${id}/acknowledge`, {}),
  saveReceiptExpense: (b: { vendor?: string | null; amountCents: number; incurredOn?: string | null; category?: string | null; description?: string | null }) =>
    api.post<{ ok: boolean; expense: { id: string; amount_cents: number; vendor: string | null } }>('/tenant/inventory/receipt-expense', b),
};
export type { ServiceRecipe, ServiceRecipeLine };

/** Products Management 07 — possible duplicates of a product being added / edited (the server decides; the POS only shows) */
export interface InvDuplicatesResult { candidates: { productId: string; name: string; sku: string | null; barcode: string | null; reasons: string[]; supplierSku: string | null; supplierName: string | null }[]; checked: Record<string, boolean> }

/** Products Management 09 — the server's Add Stock preview for this location */
export interface InvStockPreview { productId: string; branch: { id: string; name: string | null }; unit: string; quantity: number; onHand: number; incoming: number; afterAdd: number; afterAddAndIncoming: number; reorderLevel: number; criticalLevel: number; maximumStock: number | null; statusNow: string; statusAfter: string; statusAfterIncoming: string; clearsReorder: boolean; overMaximum: boolean }

/** Products Management 14 — what the server prefills a Reorder draft purchase order with */
export interface InvReorderDraft { productId: string; productName: string; branchId: string; unit: string; onHand: number; onOrder: number; reorderLevel: number; reorderQuantity: number; suggestedUnits: number;
  mapping: { vendorId: string; vendorName: string; supplierSku: string | null; unitCostCents: number | null; purchaseUnit: string | null; unitsPerPurchaseUnit: number; minimumOrderQty: number | null; leadTimeDays: number | null } | null;
  purchaseUnitsToOrder: number; unitsThatArrive: number }
