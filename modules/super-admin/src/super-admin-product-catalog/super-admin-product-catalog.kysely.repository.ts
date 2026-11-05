// Kysely (Postgres) implementation of the catalog repo. Projects inventory_products cross-tenant (Super Admin
// master view) joined to tenants / inventory_brands / inventory_vendors / inventory_categories, non-archived unless
// the retired filter is applied. Counts come from the reference tables. Exercised via ops/smoke, not the offline
// unit suite. Read-only: no inventory quantities are ever selected (branch stock stays in the tenant POS).

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { CatalogRepo, CatalogScope, ProductChangeRow, ProductProjectionRow, TenantProductConfigRow } from './super-admin-product-catalog.repository';

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

export class KyselyCatalogRepo implements CatalogRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async loadProductProjection(scope: CatalogScope): Promise<ProductProjectionRow[]> {
    const t = scope.tenantId ? sql`AND p.tenant_id = ${scope.tenantId}` : sql``;
    const st = scope.status === 'active' ? sql`AND p.archived_at IS NULL AND p.active = true`
      : scope.status === 'retired' ? sql`AND (p.archived_at IS NOT NULL OR p.active = false)`
      : sql``;
    const s = scope.search ? sql`AND (lower(p.name) LIKE ${'%' + scope.search.toLowerCase() + '%'} OR lower(p.sku) LIKE ${'%' + scope.search.toLowerCase() + '%'} OR p.barcode LIKE ${'%' + scope.search + '%'})` : sql``;
    const cap = Math.max(1, Math.min(5000, scope.cap ?? 2000));
    try {
      const res = await sql<any>`
        SELECT p.id, p.tenant_id, p.name, p.sku, p.barcode, p.upc, p.cost_cents, p.retail_price_cents,
               p.unit_type, p.active, p.archived_at,
               t.display_name AS tenant_name, b.name AS brand_name, v.name AS vendor_name, c.name AS category_name
        FROM inventory_products p
        LEFT JOIN tenants t ON t.id = p.tenant_id
        LEFT JOIN inventory_brands b ON b.id = p.brand_id
        LEFT JOIN inventory_vendors v ON v.id = p.preferred_vendor_id
        LEFT JOIN inventory_categories c ON c.id = p.category_id
        WHERE 1=1 ${t} ${st} ${s}
        ORDER BY p.created_at DESC LIMIT ${cap}`.execute(this.db);
      return res.rows.map((r) => ({
        id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, name: r.name, brandName: r.brand_name,
        sku: r.sku, barcode: r.barcode, upc: r.upc, categoryName: r.category_name,
        costCents: num(r.cost_cents), retailPriceCents: num(r.retail_price_cents), vendorName: r.vendor_name,
        unitType: r.unit_type, active: !!r.active, archivedAt: iso(r.archived_at),
      }));
    } catch { return []; }
  }

  private async countTable(table: 'inventory_brands' | 'inventory_vendors' | 'inventory_categories', scope: CatalogScope): Promise<number> {
    const t = scope.tenantId ? sql`WHERE tenant_id = ${scope.tenantId}` : sql``;
    try {
      const res = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.raw(table)} ${t}`.execute(this.db);
      return Number(res.rows[0]?.n ?? 0);
    } catch { return 0; }
  }
  brandCount(scope: CatalogScope) { return this.countTable('inventory_brands', scope); }
  vendorCount(scope: CatalogScope) { return this.countTable('inventory_vendors', scope); }
  categoryCount(scope: CatalogScope) { return this.countTable('inventory_categories', scope); }

  /** Per-tenant rollup of product_distributions — the real linkage between master products and tenant catalogs.
   *  Returns null (→ NotConnected in the UI) if the table is unavailable, never a fabricated row. */
  async tenantProductConfigs(scope: CatalogScope): Promise<TenantProductConfigRow[] | null> {
    const t = scope.tenantId ? sql`WHERE d.tenant_id = ${scope.tenantId}` : sql``;
    try {
      const res = await sql<{ tenant_id: string; tenant_name: string | null; distributed: number; linked: number; pending: number; last_sync: string | null }>`
        SELECT d.tenant_id,
               max(t.display_name)                                    AS tenant_name,
               count(*)::int                                          AS distributed,
               count(d.tenant_product_id)::int                        AS linked,
               -- real vocabulary: pending | processing | distributed | skipped_existing | failed.
               -- 'completed' does not exist; using it would have marked EVERY row pending.
               count(*) FILTER (WHERE d.status IN ('pending','processing'))::int AS pending,
               max(d.created_at)                                      AS last_sync
          FROM product_distributions d
          LEFT JOIN tenants t ON t.id = d.tenant_id
          ${t}
         GROUP BY d.tenant_id
         ORDER BY distributed DESC
         LIMIT 10`.execute(this.db);
      return res.rows.map((r) => ({
        tenantId: r.tenant_id, tenantName: r.tenant_name,
        distributed: Number(r.distributed || 0), linked: Number(r.linked || 0), pending: Number(r.pending || 0),
        lastSyncAt: r.last_sync ? new Date(r.last_sync).toISOString() : null,
      }));
    } catch { return null; }
  }

  /** SKU reach across EVERY product row — the projection used elsewhere is capped (2,000 by default), so a
   *  ranking computed from it would silently be "top of the most recent N". This query has no cap. */
  async topProductsByReach(scope: CatalogScope, limit = 5): Promise<{ sku: string; name: string; brandName: string | null; tenants: number }[] | null> {
    const t = scope.tenantId ? sql`AND p.tenant_id = ${scope.tenantId}` : sql``;
    try {
      const res = await sql<{ sku: string; name: string; brand_name: string | null; tenants: number }>`
        SELECT lower(btrim(p.sku))                        AS sku,
               min(p.name)                                AS name,
               min(b.name)                                AS brand_name,
               count(DISTINCT p.tenant_id)::int           AS tenants
          FROM inventory_products p
          LEFT JOIN inventory_brands b ON b.id = p.brand_id
         WHERE p.sku IS NOT NULL AND btrim(p.sku) <> '' ${t}
         GROUP BY lower(btrim(p.sku))
         ORDER BY tenants DESC, name ASC
         LIMIT ${Math.max(1, Math.min(50, limit))}`.execute(this.db);
      return res.rows.map((r) => ({ sku: r.sku, name: r.name, brandName: r.brand_name, tenants: Number(r.tenants || 0) }));
    } catch { return null; }
  }

  /** Recent product changes, read from the audit trail the catalog already writes:
   *  product_master_created · product_master_retired · product_barcode_added · product_distributed.
   *  These are the ONLY product actions audited today — there is no bulk-edit audit, so this log shows real
   *  per-product events rather than the summarised "updated N products" narrative in the design. */
  async productChangeHistory(scope: CatalogScope, limit = 8): Promise<ProductChangeRow[] | null> {
    const t = scope.tenantId ? sql`AND a.tenant_id = ${scope.tenantId}` : sql``;
    try {
      const res = await sql<{ id: string; action_type: string; entity_id: string | null; product_name: string | null; actor: string | null; tenant_name: string | null; created_at: string }>`
        SELECT a.id, a.action_type, a.entity_id,
               pm.name                                        AS product_name,
               coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), '')) AS actor,
               t.display_name                                 AS tenant_name,
               a.created_at
          FROM audit_logs a
          LEFT JOIN product_master pm ON pm.id::text = a.entity_id
          LEFT JOIN users u           ON u.id = a.user_id
          LEFT JOIN tenants t         ON t.id = a.tenant_id
         WHERE a.entity_type = 'product_master' ${t}
         ORDER BY a.created_at DESC
         LIMIT ${Math.max(1, Math.min(50, limit))}`.execute(this.db);
      return res.rows.map((r) => ({
        id: r.id, action: r.action_type, entityId: r.entity_id,
        productName: r.product_name, actorName: r.actor, tenantName: r.tenant_name,
        at: new Date(r.created_at).toISOString(),
      }));
    } catch { return null; }
  }
}
