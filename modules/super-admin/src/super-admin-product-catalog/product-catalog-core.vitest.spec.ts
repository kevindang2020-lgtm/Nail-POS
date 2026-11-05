import { describe, it, expect } from 'vitest';
import { buildCatalogOverview, duplicateSkuClusters, retailPriceDistribution, hasBarcode, isRetired, type ProductLike } from './product-catalog-core';

const mk = (o: Partial<ProductLike> & { id: string; tenantId: string }): ProductLike => ({
  name: 'Product', brandName: null, sku: null, barcode: null, upc: null, categoryName: null,
  costCents: null, retailPriceCents: null, vendorName: null, unitType: 'each', active: true, archivedAt: null, ...o,
});

const products: ProductLike[] = [
  mk({ id: 'p1', tenantId: 't1', name: 'Cuticle Oil', brandName: 'CND', sku: 'CND-CO-15', barcode: '0631234567890', categoryName: 'Nail Care', retailPriceCents: 899, active: true }),
  mk({ id: 'p2', tenantId: 't2', name: 'Cuticle Oil', brandName: 'CND', sku: 'CND-CO-15', barcode: '0631234567890', categoryName: 'Nail Care', retailPriceCents: 899, active: true }), // dup SKU + barcode across tenants
  mk({ id: 'p3', tenantId: 't1', name: 'Gel Polish', brandName: 'OPI', sku: 'OPI-GP-RR', categoryName: 'Gel Polish', retailPriceCents: 1499, active: true }),
  mk({ id: 'p4', tenantId: 't1', name: 'Retired Base', brandName: 'CND', sku: 'CND-BC', categoryName: 'Gel Polish', retailPriceCents: 1099, active: false, archivedAt: '2026-01-01T00:00:00Z' }),
  mk({ id: 'p5', tenantId: 't3', name: 'No Barcode No Price', brandName: 'Mia', sku: 'MIA-1', categoryName: 'Acrylic' }),
];

describe('product-catalog-oversight engine', () => {
  it('flags barcode presence and retired state', () => {
    expect(hasBarcode(products[0])).toBe(true);
    expect(hasBarcode(products[4])).toBe(false);
    expect(isRetired(products[3])).toBe(true);
    expect(isRetired(products[0])).toBe(false);
  });

  it('detects duplicate SKU clusters (2+ records sharing a SKU)', () => {
    const dup = duplicateSkuClusters(products);
    expect(dup.size).toBe(1); // CND-CO-15 appears on p1 + p2
    expect([...dup.values()][0].length).toBe(2);
  });

  it('buckets suggested retail prices', () => {
    const dist = retailPriceDistribution(products);
    expect(dist.find((b) => b.key === '5_10')!.count).toBe(2);   // 899, 899
    expect(dist.find((b) => b.key === '10_20')!.count).toBe(2);  // 1499, 1099
    expect(dist.find((b) => b.key === 'lt5')!.count).toBe(0);
  });

  it('computes the 12 KPIs in reference order with honest NotConnected', () => {
    const ov = buildCatalogOverview({ products, brandCount: 3, vendorCount: 4, categoryCount: 5, importErrors: null, syncUpdates: null });
    expect(ov.kpis.map((k) => k.key)).toEqual([
      'total_products', 'active_brands', 'duplicate_products', 'import_errors', 'products_with_barcodes',
      'suggested_retail_configured', 'active_tenants', 'retired_products', 'taxable_products', 'vendors',
      'product_categories', 'product_sync_updates',
    ]);
    const byKey = Object.fromEntries(ov.kpis.map((k) => [k.key, k]));
    expect(byKey.total_products.value).toBe('5');
    expect(byKey.active_brands.value).toBe('3');
    expect(byKey.duplicate_products.value).toBe('2');
    expect(byKey.products_with_barcodes.value).toBe('2');
    expect(byKey.suggested_retail_configured.value).toBe('4');
    expect(byKey.active_tenants.value).toBe('3');
    expect(byKey.retired_products.value).toBe('1');
    expect(byKey.vendors.value).toBe('4');
    expect(byKey.product_categories.value).toBe('5');
    // honest NotConnected
    for (const k of ['import_errors', 'taxable_products', 'product_sync_updates']) {
      expect(byKey[k].available).toBe(false);
      expect(byKey[k].value).toBeNull();
    }
  });

  it('reports duplicate detection stats and at-a-glance rates', () => {
    const ov = buildCatalogOverview({ products, brandCount: 3, vendorCount: 4, categoryCount: 5 });
    expect(ov.duplicateDetection.duplicateSkus).toBe(1);
    expect(ov.duplicateDetection.duplicateBarcodes).toBe(1);
    expect(ov.atAGlance.barcodeCoveragePct).toBe(40);  // 2 of 5
    expect(ov.atAGlance.duplicateRatePct).toBe(40);    // 2 of 5
    expect(ov.atAGlance.importSuccessRate).toBeNull(); // NotConnected
  });

  it('summarizes category and brand distributions', () => {
    const ov = buildCatalogOverview({ products, brandCount: 3, vendorCount: 4, categoryCount: 5 });
    expect(ov.byCategory.find((c) => c.label === 'Nail Care')!.count).toBe(2);
    expect(ov.byBrand.find((b) => b.label === 'CND')!.count).toBe(3);
  });
});

// ── Top products by tenant reach ────────────────────────────────────────────────────────────────────────────
// Built for the Product Catalog picture's "Top Products by Tenant Usage" panel. The catalog directory is served
// 10 rows at a time out of thousands, so this MUST aggregate the whole catalog — a page-local "top 5" would be
// a plausible lie. These pin the ranking rule, not the label.
describe('topProductsByTenantReach', () => {
  const p = (id: string, tenantId: string, sku: string, name: string, brandName: string | null = null) =>
    ({ id, tenantId, sku, name, brandName, barcode: null, upc: null, active: true, archivedAt: null }) as any;

  it('ranks by DISTINCT tenants carrying the SKU, not by row count', async () => {
    const { topProductsByTenantReach } = await import('./product-catalog-core');
    const products = [
      p('1', 't1', 'SKU-A', 'Cuticle Oil'), p('2', 't1', 'SKU-A', 'Cuticle Oil'), p('3', 't1', 'SKU-A', 'Cuticle Oil'), // 3 rows, ONE tenant
      p('4', 't1', 'SKU-B', 'Base Coat'), p('5', 't2', 'SKU-B', 'Base Coat'),                                          // 2 rows, TWO tenants
    ];
    const top = topProductsByTenantReach(products, 5);
    expect(top[0].sku).toBe('sku-b');
    expect(top[0].tenants).toBe(2);
    expect(top[1].tenants).toBe(1);
  });

  it('aggregates across the whole input and honours the limit', async () => {
    const { topProductsByTenantReach } = await import('./product-catalog-core');
    const products = [
      p('1', 't1', 'SKU-A', 'A'), p('2', 't2', 'SKU-A', 'A'), p('3', 't3', 'SKU-A', 'A'),
      p('4', 't1', 'SKU-B', 'B'), p('5', 't2', 'SKU-B', 'B'),
      p('6', 't1', 'SKU-C', 'C'),
    ];
    expect(topProductsByTenantReach(products, 2).map((x) => x.tenants)).toEqual([3, 2]);
    expect(topProductsByTenantReach(products, 99)).toHaveLength(3);
  });

  it('skips rows with no SKU and breaks ties by name for a stable list', async () => {
    const { topProductsByTenantReach } = await import('./product-catalog-core');
    const products = [
      p('1', 't1', '', 'No SKU'), p('2', 't1', '   ', 'Blank SKU'),
      p('3', 't1', 'SKU-Z', 'Zebra'), p('4', 't1', 'SKU-A', 'Apple'),
    ];
    const top = topProductsByTenantReach(products, 5);
    expect(top).toHaveLength(2);
    expect(top.map((x) => x.name)).toEqual(['Apple', 'Zebra']);
  });
});
