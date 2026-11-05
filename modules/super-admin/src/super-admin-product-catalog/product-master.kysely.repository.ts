// Kysely (Postgres) implementation of the master-product repo. Writes are audited (product_master_created /
// product_master_retired) in the same statement flow. Retirement preserves the record. Money is integer cents.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { normalizeSku, normalizeName, type MasterProductInput, type ExistingMaster } from './product-master-core';
import type { MasterProductRepo, MasterListScope, MasterProductRow } from './product-master.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { PRODUCT_MASTER } from '../lifecycles';

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

function mapRow(r: any): MasterProductRow {
  return {
    id: r.id, code: r.code, name: r.name, brandName: r.brand_name, sku: r.sku, normalizedSku: r.normalized_sku,
    upc: r.upc, barcode: r.barcode, categoryName: r.category_name, costCents: num(r.cost_cents),
    suggestedRetailCents: num(r.suggested_retail_cents), currency: r.currency || 'USD', taxCategory: r.tax_category,
    inventoryUnit: r.inventory_unit || 'each', vendorName: r.vendor_name, status: r.status, optionalProduct: !!r.optional_product,
    createdByUserId: r.created_by_user_id, retiredAt: iso(r.retired_at), createdAt: iso(r.created_at) as string,
  };
}

export class KyselyMasterProductRepo implements MasterProductRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async listMasters(scope: MasterListScope): Promise<MasterProductRow[]> {
    const st = scope.status ? sql`AND status = ${scope.status}` : sql``;
    const s = scope.search ? sql`AND (lower(name) LIKE ${'%' + scope.search.toLowerCase() + '%'} OR lower(sku) LIKE ${'%' + scope.search.toLowerCase() + '%'} OR barcode LIKE ${'%' + scope.search + '%'})` : sql``;
    const cap = Math.max(1, Math.min(2000, scope.cap ?? 500));
    try {
      const res = await sql<any>`SELECT * FROM product_master WHERE 1=1 ${st} ${s} ORDER BY created_at DESC LIMIT ${cap}`.execute(this.db);
      return res.rows.map(mapRow);
    } catch { return []; }
  }

  async existingForDuplicateCheck(): Promise<ExistingMaster[]> {
    try {
      const res = await sql<any>`SELECT id, name, normalized_sku, barcode, upc, brand_name, normalized_name FROM product_master WHERE status NOT IN ('retired','discontinued','archived','rejected')`.execute(this.db);
      return res.rows.map((r) => ({ id: r.id, name: r.name, normalizedSku: r.normalized_sku, barcode: r.barcode || r.upc, brandName: r.brand_name, normalizedName: r.normalized_name }));
    } catch { return []; }
  }

  async codeExists(code: string): Promise<boolean> {
    try {
      const res = await sql<{ n: number }>`SELECT count(*)::int AS n FROM product_master WHERE code = ${code}`.execute(this.db);
      return Number(res.rows[0]?.n ?? 0) > 0;
    } catch { return false; }
  }

  async createMaster(input: MasterProductInput & { status?: string; createdByUserId?: string | null }): Promise<MasterProductRow> {
    const nName = normalizeName(input.name);
    const nSku = normalizeSku(input.sku);
    const res = await sql<any>`
      INSERT INTO product_master (code, name, normalized_name, brand_name, sku, normalized_sku, manufacturer_sku, upc, barcode,
        category_name, product_type, description, cost_cents, suggested_retail_cents, currency, tax_category, inventory_unit,
        vendor_name, status, created_by_user_id)
      VALUES (${input.code ?? null}, ${input.name}, ${nName}, ${input.brandName ?? null}, ${input.sku ?? null}, ${nSku},
        ${input.manufacturerSku ?? null}, ${input.upc ?? null}, ${input.barcode ?? null}, ${input.categoryName ?? null},
        ${input.productType ?? null}, ${input.description ?? null}, ${input.costCents ?? null}, ${input.suggestedRetailCents ?? null},
        ${input.currency ?? 'USD'}, ${input.taxCategory ?? null}, ${input.inventoryUnit ?? 'each'}, ${input.vendorName ?? null},
        ${input.status ?? 'draft'}, ${input.createdByUserId ?? null})
      RETURNING *`.execute(this.db);
    const row = mapRow(res.rows[0]);
    await this.audit('product_master_created', row.id, input.createdByUserId ?? null);
    return row;
  }

  async retireMaster(id: string, reason: string, byUserId: string | null): Promise<MasterProductRow | null> {
    const res = await sql<any>`
      UPDATE product_master SET status = 'retired', retired_at = now(), retired_reason = ${reason}, retired_by_user_id = ${byUserId}, updated_at = now()
      WHERE id = ${id} AND ${canMoveToSql(PRODUCT_MASTER, 'retired')} RETURNING *`.execute(this.db);
    if (!res.rows[0]) return null;
    const row = mapRow(res.rows[0]);
    await this.audit('product_master_retired', id, byUserId);
    return row;
  }

  private async audit(action: string, entityId: string, userId: string | null): Promise<void> {
    try {
      await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at)
                VALUES (${action}, 'product_master', ${entityId}, ${userId}, now())`.execute(this.db);
    } catch { /* audit is best-effort; never blocks the write path */ }
  }
}
