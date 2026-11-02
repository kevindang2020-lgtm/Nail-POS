// Product Catalog oversight service. Composes the pure engine's KPIs/charts with a paginated Master Product Library
// directory whose per-row fields (tenant reach, duplicate flag, import status) are derived cross-tenant. Honest:
// import status has no backing pipeline, so it renders NotConnected.

import { buildCatalogOverview, duplicateSkuClusters, tenantReachBySku, topProductsByTenantReach, type ProductLike } from './product-catalog-core';
import type { CatalogRepo, CatalogScope, ProductProjectionRow } from './super-admin-product-catalog.repository';

export interface CatalogQuery extends CatalogScope {
  page?: number; pageSize?: number;
  duplicateOnly?: boolean;
  sort?: 'name' | 'brand' | 'sku' | 'category' | 'cost' | 'retail' | 'tenants';
  direction?: 'asc' | 'desc';
}

export interface CatalogRow {
  id: string; name: string; brandName: string | null; sku: string | null; barcode: string | null;
  categoryName: string | null; costCents: number | null; retailPriceCents: number | null; taxCategory: string | null;
  unitType: string | null; vendorName: string | null; tenantId: string; tenantName: string | null;
  activeTenants: number; importStatus: string; importStatusAvailable: boolean; duplicateFlag: boolean; status: string;
}

export class CatalogOversightService {
  constructor(private readonly repo: CatalogRepo) {}

  async getOverview(q: CatalogQuery = {}, extras: { importErrors?: number | null } = {}) {
    const scope: CatalogScope = { tenantId: q.tenantId, categoryId: q.categoryId, brandId: q.brandId, vendorId: q.vendorId, status: q.status, search: q.search, cap: q.cap };
    const [products, brandCount, vendorCount, categoryCount] = await Promise.all([
      this.repo.loadProductProjection(scope),
      this.repo.brandCount(scope),
      this.repo.vendorCount(scope),
      this.repo.categoryCount(scope),
    ]);

    const tenantConfigs = this.repo.tenantProductConfigs ? await this.repo.tenantProductConfigs(scope).catch(() => null) : null;
    const changeHistory = this.repo.productChangeHistory ? await this.repo.productChangeHistory(scope, 8).catch(() => null) : null;
    const topFull = this.repo.topProductsByReach ? await this.repo.topProductsByReach(scope, 5).catch(() => null) : null;

    const ov = buildCatalogOverview({ products, brandCount, vendorCount, categoryCount, importErrors: extras.importErrors ?? null, syncUpdates: null });

    // Per-row derivations: tenant reach (distinct tenants sharing the SKU) + duplicate flag (SKU on 2+ records).
    const reach = tenantReachBySku(products);
    const dupSkuKeys = new Set([...duplicateSkuClusters(products).keys()]);
    const skuKey = (p: ProductLike) => (p.sku ? `sku|${p.sku.trim().toLowerCase()}` : null);

    let dir: CatalogRow[] = (products as ProductProjectionRow[]).map((p) => ({
      id: p.id, name: p.name, brandName: p.brandName, sku: p.sku, barcode: p.barcode || p.upc,
      categoryName: p.categoryName, costCents: p.costCents, retailPriceCents: p.retailPriceCents,
      taxCategory: null,                     // no tax field on products → NotConnected
      unitType: p.unitType, vendorName: p.vendorName, tenantId: p.tenantId, tenantName: p.tenantName,
      activeTenants: p.sku ? (reach.get(p.sku.trim().toLowerCase()) ?? 1) : 1,
      importStatus: 'NotConnected', importStatusAvailable: false, // no import pipeline modelled
      duplicateFlag: (() => { const k = skuKey(p); return !!k && dupSkuKeys.has(k); })(),
      status: (!p.active || p.archivedAt) ? 'Retired' : 'Active',
    }));

    if (q.duplicateOnly) dir = dir.filter((r) => r.duplicateFlag);

    if (q.sort) {
      const dirn = q.direction === 'desc' ? -1 : 1;
      const val = (r: CatalogRow) => q.sort === 'name' ? r.name.toLowerCase()
        : q.sort === 'brand' ? (r.brandName || '').toLowerCase()
        : q.sort === 'sku' ? (r.sku || '').toLowerCase()
        : q.sort === 'category' ? (r.categoryName || '').toLowerCase()
        : q.sort === 'cost' ? (r.costCents ?? -1)
        : q.sort === 'retail' ? (r.retailPriceCents ?? -1)
        : r.activeTenants;
      dir = [...dir].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -dirn : va > vb ? dirn : 0; });
    }

    const filteredTotal = dir.length;
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, q.pageSize ?? 10));
    const start = (page - 1) * pageSize;
    const pageRows = dir.slice(start, start + pageSize);

    return {
      kpis: ov.kpis,
      byCategory: ov.byCategory,
      byBrand: ov.byBrand,
      retailPriceDistribution: ov.retailPriceDistribution,
      duplicateDetection: ov.duplicateDetection,
      atAGlance: ov.atAGlance,
      // Top products by tenant reach — aggregated across the FULL catalog before pagination, so the panel can
      // never show "top of the current page" (the directory is served 10 rows at a time out of thousands).
      topByTenantUsage: topFull ?? topProductsByTenantReach(products as ProductLike[], 5),
      // Honest scope marker: true only when the ranking came from the uncapped full-table query. When it falls
      // back to the projection (capped, newest-first) the UI says so rather than implying a catalog-wide rank.
      topByTenantUsageScansAll: topFull != null,
      // Per-tenant distribution rollup. null when the repository can't supply it → the panel says NotConnected.
      tenantProductConfigs: tenantConfigs,
      // Real audited product events; null → NotConnected. No bulk-edit audit exists, so this is per-product.
      productChangeHistory: changeHistory,
      counts: ov.counts,
      directory: pageRows,
      directoryTotal: filteredTotal,
      pagination: { page, pageSize, totalItems: filteredTotal, totalPages: Math.max(1, Math.ceil(filteredTotal / pageSize)) },
    };
  }
}
