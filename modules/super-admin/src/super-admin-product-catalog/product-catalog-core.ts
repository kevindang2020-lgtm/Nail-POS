// Product Catalog oversight — pure, DB-free engine. Computes the platform-level catalog KPIs, duplicate-SKU/barcode
// detection, category/brand/price distributions, and at-a-glance rates from a cross-tenant product projection.
// BOUNDARY: this is master-catalog OVERSIGHT only — branch inventory counts, purchase orders, and stock
// adjustments deliberately stay in the tenant POS and are never modelled here.
// HONEST RENDERING: values with no backing schema (import errors, tax category, sync updates) are surfaced as
// available:false, never fabricated.

export interface ProductLike {
  id: string;
  tenantId: string;
  name: string;
  brandName: string | null;
  sku: string | null;
  barcode: string | null;
  upc: string | null;
  categoryName: string | null;
  costCents: number | null;
  retailPriceCents: number | null;
  vendorName: string | null;
  unitType: string | null;
  active: boolean;
  archivedAt: string | null;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
export const hasBarcode = (p: ProductLike): boolean => !!(norm(p.barcode) || norm(p.upc));
export const isRetired = (p: ProductLike): boolean => !!p.archivedAt || !p.active;
export const isActive = (p: ProductLike): boolean => !isRetired(p);

/** Cluster product records by a shared normalized key (sku or barcode). Clusters of 2+ are duplicate candidates.
 *  NOTE: this flags data-quality duplicates (the same identifier on multiple product records); it is distinct from
 *  legitimate cross-tenant adoption of the same real product, which is surfaced separately as tenant reach. */
export function clustersByKey(products: ProductLike[], key: (p: ProductLike) => string | null): Map<string, ProductLike[]> {
  const m = new Map<string, ProductLike[]>();
  for (const p of products) {
    const k = key(p);
    if (!k) continue;
    const arr = m.get(k) || [];
    arr.push(p);
    m.set(k, arr);
  }
  return new Map([...m.entries()].filter(([, arr]) => arr.length > 1));
}

export function duplicateSkuClusters(products: ProductLike[]): Map<string, ProductLike[]> {
  return clustersByKey(products, (p) => (norm(p.sku) ? `sku|${norm(p.sku)}` : null));
}
export function duplicateBarcodeClusters(products: ProductLike[]): Map<string, ProductLike[]> {
  return clustersByKey(products, (p) => { const b = norm(p.barcode) || norm(p.upc); return b ? `bc|${b}` : null; });
}

/** How many distinct tenants carry a product with this product's SKU (tenant reach / adoption). */
export function tenantReachBySku(products: ProductLike[]): Map<string, number> {
  const bySku = new Map<string, Set<string>>();
  for (const p of products) {
    const s = norm(p.sku);
    if (!s) continue;
    const set = bySku.get(s) || new Set<string>();
    set.add(p.tenantId);
    bySku.set(s, set);
  }
  return new Map([...bySku.entries()].map(([s, set]) => [s, set.size]));
}

/** Top distinct products by tenant reach — computed across the WHOLE catalog, never a page.
 *  Products are grouped by SKU (the same identity the reach map uses); the display name is the first
 *  non-empty name seen for that SKU. Ties break by name so the list is stable between calls. */
export function topProductsByTenantReach(
  products: ProductLike[],
  limit = 5,
): { sku: string; name: string; brandName: string | null; tenants: number }[] {
  const reach = tenantReachBySku(products);
  const meta = new Map<string, { name: string; brandName: string | null }>();
  for (const p of products) {
    const s = norm(p.sku);
    if (!s || meta.has(s)) continue;
    meta.set(s, { name: (p as any).name || s, brandName: (p as any).brandName ?? null });
  }
  return [...reach.entries()]
    .map(([sku, tenants]) => ({ sku, tenants, name: meta.get(sku)?.name ?? sku, brandName: meta.get(sku)?.brandName ?? null }))
    .sort((a, b) => b.tenants - a.tenants || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit));
}

export const RETAIL_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: 'lt5', label: '< $5', min: 0, max: 500 },
  { key: '5_10', label: '$5–$10', min: 500, max: 1000 },
  { key: '10_20', label: '$10–$20', min: 1000, max: 2000 },
  { key: '20_30', label: '$20–$30', min: 2000, max: 3000 },
  { key: '30_50', label: '$30–$50', min: 3000, max: 5000 },
  { key: 'gte50', label: '$50+', min: 5000, max: Infinity },
];

export function retailPriceDistribution(products: ProductLike[]): { key: string; label: string; count: number }[] {
  return RETAIL_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    count: products.filter((p) => p.retailPriceCents != null && p.retailPriceCents >= b.min && p.retailPriceCents < b.max).length,
  }));
}

function topCounts(products: ProductLike[], pick: (p: ProductLike) => string | null, topN: number): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of products) { const v = pick(p); if (!v) continue; m.set(v, (m.get(v) || 0) + 1); }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, topN);
}

const pct = (num: number, den: number): number => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);

export interface CatalogInputs {
  products: ProductLike[];
  brandCount: number;         // distinct/active brands (from inventory_brands)
  vendorCount: number;        // from inventory_vendors
  categoryCount: number;      // from inventory_categories
  importErrors?: number | null;   // no backing schema yet → null
  syncUpdates?: number | null;    // no backing schema yet → null
}

export interface CatalogKpi { key: string; label: string; value: string | null; supporting?: string; available: boolean; to?: string }

export function buildCatalogOverview(input: CatalogInputs) {
  const all = input.products;
  const live = all.filter(isActive);
  const total = all.length;
  const withBarcode = all.filter(hasBarcode).length;
  const withRetail = all.filter((p) => p.retailPriceCents != null).length;
  const retired = all.filter(isRetired).length;
  const tenants = new Set(all.map((p) => p.tenantId)).size;

  const dupSku = duplicateSkuClusters(all);
  const dupBarcode = duplicateBarcodeClusters(all);
  const duplicateProducts = [...dupSku.values()].reduce((a, arr) => a + arr.length, 0);
  const potentialMatches = duplicateProducts + [...dupBarcode.values()].reduce((a, arr) => a + arr.length, 0);

  const kpi = (key: string, label: string, value: string | null, extra: Partial<CatalogKpi> = {}): CatalogKpi =>
    ({ key, label, value, available: value !== null, ...extra });

  const kpis: CatalogKpi[] = [
    kpi('total_products', 'Total Products', total.toLocaleString()),
    kpi('active_brands', 'Active Brands', input.brandCount.toLocaleString()),
    kpi('duplicate_products', 'Duplicate Products', duplicateProducts.toLocaleString(), { supporting: `${dupSku.size} SKU groups` }),
    kpi('import_errors', 'Import Errors', input.importErrors == null ? null : input.importErrors.toLocaleString()),
    kpi('products_with_barcodes', 'Products With Barcodes', withBarcode.toLocaleString(), { supporting: `${pct(withBarcode, total)}% coverage` }),
    kpi('suggested_retail_configured', 'Suggested Retail Configured', withRetail.toLocaleString(), { supporting: `${pct(withRetail, total)}%` }),
    kpi('active_tenants', 'Active Tenants Using Products', tenants.toLocaleString()),
    kpi('retired_products', 'Retired Products', retired.toLocaleString()),
    kpi('taxable_products', 'Taxable Products', null),          // no tax field on products → NotConnected
    kpi('vendors', 'Vendors', input.vendorCount.toLocaleString()),
    kpi('product_categories', 'Product Categories', input.categoryCount.toLocaleString()),
    kpi('product_sync_updates', 'Product Sync Updates', input.syncUpdates == null ? null : input.syncUpdates.toLocaleString()),
  ];

  return {
    kpis,
    byCategory: topCounts(all, (p) => p.categoryName, 8),
    byBrand: topCounts(all, (p) => p.brandName, 6),
    retailPriceDistribution: retailPriceDistribution(all),
    duplicateDetection: {
      duplicateSkus: dupSku.size,
      duplicateBarcodes: dupBarcode.size,
      potentialMatches,
    },
    atAGlance: {
      barcodeCoveragePct: pct(withBarcode, total),
      duplicateRatePct: pct(duplicateProducts, total),
      retailConfiguredPct: pct(withRetail, total),
      importSuccessRate: null as number | null, // no import pipeline modelled → NotConnected
    },
    counts: { total, live: live.length, retired, tenants, withBarcode, withRetail },
  };
}
