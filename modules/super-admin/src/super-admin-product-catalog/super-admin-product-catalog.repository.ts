// Repository for Product Catalog oversight. Projects inventory_products cross-tenant (the Super Admin master view)
// joined to brands / vendors / categories, plus the reference-count metrics. In-memory implementation seeds a small
// multi-tenant catalog — including a cross-tenant shared SKU and a within-tenant duplicate — so the engine's
// duplicate detection and tenant-reach logic are exercised without a database.

import type { ProductLike } from './product-catalog-core';

export interface ProductProjectionRow extends ProductLike { tenantName: string | null }
export interface CatalogScope { tenantId?: string; categoryId?: string; brandId?: string; vendorId?: string; status?: string; search?: string; cap?: number }

export type TenantProductConfigRow = {
  tenantId: string; tenantName: string | null;
  distributed: number;          // master products pushed to this tenant
  linked: number;               // of those, rows actually linked to a tenant-owned product
  pending: number;              // distributions not yet completed
  lastSyncAt: string | null;    // most recent distribution activity
};

export type ProductChangeRow = {
  id: string; action: string; productName: string | null; entityId: string | null;
  actorName: string | null; tenantName: string | null; at: string;
};

export interface CatalogRepo {
  loadProductProjection(scope: CatalogScope): Promise<ProductProjectionRow[]>;
  brandCount(scope: CatalogScope): Promise<number>;
  vendorCount(scope: CatalogScope): Promise<number>;
  categoryCount(scope: CatalogScope): Promise<number>;
  /** Per-tenant distribution rollup for the "Compare Tenant Product Configurations" panel.
   *  Optional: an implementation without the distributions table simply returns null and the panel
   *  renders NotConnected rather than inventing rows. */
  tenantProductConfigs?(scope: CatalogScope): Promise<TenantProductConfigRow[] | null>;
  /** Top products by distinct tenant reach, computed over the FULL products table (not the capped projection).
   *  null → the service falls back to the in-memory ranking over the projection and the payload says so. */
  topProductsByReach?(scope: CatalogScope, limit?: number): Promise<{ sku: string; name: string; brandName: string | null; tenants: number }[] | null>;
  /** Recent product change events from audit_logs (entity_type 'product_master').
   *  Optional: null → the panel renders NotConnected rather than an invented history. */
  productChangeHistory?(scope: CatalogScope, limit?: number): Promise<ProductChangeRow[] | null>;
}

const row = (o: Partial<ProductProjectionRow> & { id: string; tenantId: string; tenantName: string }): ProductProjectionRow => ({
  name: 'Product', brandName: null, sku: null, barcode: null, upc: null, categoryName: null,
  costCents: null, retailPriceCents: null, vendorName: null, unitType: 'each', active: true, archivedAt: null, ...o,
});

const DEFAULT_SEED: ProductProjectionRow[] = [
  row({ id: 'PRD-1001', tenantId: 't1', tenantName: 'Glamour Studio', name: 'Cuticle Oil', brandName: 'CND', sku: 'CND-CO-15', barcode: '0631234567890', categoryName: 'Nail Care', costCents: 320, retailPriceCents: 899, vendorName: 'CND Supply' }),
  row({ id: 'PRD-1002', tenantId: 't2', tenantName: 'Luxe Salon & Spa', name: 'Cuticle Oil', brandName: 'CND', sku: 'CND-CO-15', barcode: '0631234567890', categoryName: 'Nail Care', costCents: 320, retailPriceCents: 899, vendorName: 'CND Supply' }), // cross-tenant same SKU (adoption + dup candidate)
  row({ id: 'PRD-1003', tenantId: 't1', tenantName: 'Glamour Studio', name: 'Gel Polish – Ruby Red', brandName: 'OPI', sku: 'OPI-GP-RR', barcode: '0941234567891', categoryName: 'Gel Polish', costCents: 650, retailPriceCents: 1499, vendorName: 'OPI Pro' }),
  row({ id: 'PRD-1004', tenantId: 't1', tenantName: 'Glamour Studio', name: 'Acrylic Powder – Clear', brandName: 'Mia Secret', sku: 'MS-AP-CLEAR', barcode: '0685712345672', categoryName: 'Acrylic', costCents: 780, retailPriceCents: 1899, vendorName: 'Mia Secret' }),
  row({ id: 'PRD-1005', tenantId: 't3', tenantName: 'The Hair Lounge', name: 'Top Coat – No Wipe', brandName: 'Gelish', sku: 'GEL-TC-NW', categoryName: 'Gel Polish', costCents: 540, retailPriceCents: 1299, vendorName: 'Gelish Pro' }), // no barcode
  row({ id: 'PRD-1006', tenantId: 't1', tenantName: 'Glamour Studio', name: 'Base Coat', brandName: 'CND', sku: 'CND-BC-15', barcode: '0631234567893', categoryName: 'Gel Polish', costCents: 410, retailPriceCents: 1099, vendorName: 'CND Supply' }),
  row({ id: 'PRD-1007', tenantId: 't2', tenantName: 'Luxe Salon & Spa', name: 'Nail File Set (5pc)', brandName: 'Tweezerman', sku: 'TW-FILE-5', barcode: '0380976532100', categoryName: 'Tools', costCents: 480, retailPriceCents: 1249, vendorName: 'Tweezerman' }),
  row({ id: 'PRD-1008', tenantId: 't3', tenantName: 'The Hair Lounge', name: 'Retired Acetone', brandName: 'SuperNail', sku: 'SN-ACE-16', categoryName: 'Liquids', costCents: 210, retailPriceCents: 649, vendorName: 'SuperNail', active: false, archivedAt: '2026-02-01T00:00:00Z' }), // retired
];

export class InMemoryCatalogRepo implements CatalogRepo {
  constructor(private readonly seed: ProductProjectionRow[] = DEFAULT_SEED) {}
  private scoped(scope: CatalogScope): ProductProjectionRow[] {
    let rows = this.seed;
    if (scope.tenantId) rows = rows.filter((r) => r.tenantId === scope.tenantId);
    if (scope.status === 'active') rows = rows.filter((r) => r.active && !r.archivedAt);
    if (scope.status === 'retired') rows = rows.filter((r) => !r.active || !!r.archivedAt);
    if (scope.search) { const q = scope.search.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q) || (r.barcode || '').includes(q)); }
    return rows;
  }
  async loadProductProjection(scope: CatalogScope): Promise<ProductProjectionRow[]> { return this.scoped(scope).slice(0, scope.cap ?? 1000); }
  async brandCount(scope: CatalogScope): Promise<number> { return new Set(this.scoped(scope).map((r) => r.brandName).filter(Boolean)).size; }
  async vendorCount(scope: CatalogScope): Promise<number> { return new Set(this.scoped(scope).map((r) => r.vendorName).filter(Boolean)).size; }
  async categoryCount(scope: CatalogScope): Promise<number> { return new Set(this.scoped(scope).map((r) => r.categoryName).filter(Boolean)).size; }
}
