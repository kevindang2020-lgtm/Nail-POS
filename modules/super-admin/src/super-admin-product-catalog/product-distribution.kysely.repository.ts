// Kysely (Postgres) distribution repo. recordDistribution is idempotent via the unique (master, tenant) index; when
// action is 'distributed' it creates a tenant-owned inventory_products row copied from the master (server-set
// tenant_id, no branch stock, no quantities). Tenant customizations on any pre-existing product are never touched.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { DistributionRepo, DistributionRow } from './product-distribution.repository';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const mapRow = (r: any): DistributionRow => ({
  id: r.id, masterProductId: r.master_product_id, tenantId: r.tenant_id, status: r.status, tenantProductId: r.tenant_product_id,
  reason: r.reason, detail: r.detail, createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at) as string, completedAt: iso(r.completed_at),
});

export class KyselyDistributionRepo implements DistributionRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async masterExists(id: string): Promise<boolean> {
    try { const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM product_master WHERE id = ${id}`.execute(this.db); return Number(r.rows[0]?.n ?? 0) > 0; } catch { return false; }
  }
  async alreadyDistributedTenants(masterProductId: string): Promise<Set<string>> {
    try { const r = await sql<any>`SELECT tenant_id FROM product_distributions WHERE master_product_id = ${masterProductId}`.execute(this.db); return new Set(r.rows.map((x) => x.tenant_id)); } catch { return new Set(); }
  }
  async tenantsCarrying(masterProductId: string, tenantIds: string[]): Promise<Set<string>> {
    if (!tenantIds.length) return new Set();
    try {
      // "carrying" = tenant already has an inventory_products row with the master's SKU.
      const r = await sql<any>`
        SELECT DISTINCT p.tenant_id FROM inventory_products p
        JOIN product_master m ON m.id = ${masterProductId}
        WHERE p.tenant_id = ANY(${tenantIds}) AND m.normalized_sku IS NOT NULL
          AND upper(regexp_replace(coalesce(p.sku,''), '\\s', '', 'g')) = m.normalized_sku`.execute(this.db);
      return new Set(r.rows.map((x) => x.tenant_id));
    } catch { return new Set(); }
  }

  async recordDistribution(input: { masterProductId: string; tenantId: string; status: 'distributed' | 'skipped_existing'; reason: string | null; createdByUserId: string | null }): Promise<DistributionRow> {
    // Idempotent insert of the distribution row (unique master+tenant). ON CONFLICT returns the existing row.
    const existing = await sql<any>`SELECT * FROM product_distributions WHERE master_product_id = ${input.masterProductId} AND tenant_id = ${input.tenantId} LIMIT 1`.execute(this.db);
    if (existing.rows[0]) return mapRow(existing.rows[0]);

    let tenantProductId: string | null = null;
    if (input.status === 'distributed') {
      // Create the tenant-owned product from the master. tenant_id is server-set; NO branch stock is created.
      const tp = await sql<any>`
        INSERT INTO inventory_products (tenant_id, name, sku, barcode, upc, cost_cents, retail_price_cents, unit_type, is_retail, active)
        SELECT ${input.tenantId}, m.name, m.sku, m.barcode, m.upc, m.cost_cents, m.suggested_retail_cents, m.inventory_unit, m.is_retail, true
        FROM product_master m WHERE m.id = ${input.masterProductId}
        RETURNING id`.execute(this.db);
      tenantProductId = tp.rows[0]?.id ?? null;
    }
    const ins = await sql<any>`
      INSERT INTO product_distributions (master_product_id, tenant_id, status, tenant_product_id, reason, created_by_user_id, completed_at)
      VALUES (${input.masterProductId}, ${input.tenantId}, ${input.status}, ${tenantProductId}, ${input.reason}, ${input.createdByUserId}, now())
      ON CONFLICT (master_product_id, tenant_id) DO NOTHING RETURNING *`.execute(this.db);
    if (ins.rows[0]) { await this.audit(input.masterProductId, input.tenantId, input.createdByUserId); return mapRow(ins.rows[0]); }
    // Lost a race → return the row that won.
    const again = await sql<any>`SELECT * FROM product_distributions WHERE master_product_id = ${input.masterProductId} AND tenant_id = ${input.tenantId} LIMIT 1`.execute(this.db);
    return mapRow(again.rows[0]);
  }

  async listDistributions(scope: { masterProductId?: string; tenantId?: string; cap?: number }): Promise<DistributionRow[]> {
    const m = scope.masterProductId ? sql`AND master_product_id = ${scope.masterProductId}` : sql``;
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    try { const r = await sql<any>`SELECT * FROM product_distributions WHERE 1=1 ${m} ${t} ORDER BY created_at DESC LIMIT ${Math.min(500, scope.cap ?? 200)}`.execute(this.db); return r.rows.map(mapRow); } catch { return []; }
  }

  private async audit(masterId: string, tenantId: string, userId: string | null): Promise<void> {
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, tenant_id, created_at) VALUES ('product_distributed', 'product_master', ${masterId}, ${userId}, ${tenantId}, now())`.execute(this.db); } catch { /* best-effort */ }
  }
}
