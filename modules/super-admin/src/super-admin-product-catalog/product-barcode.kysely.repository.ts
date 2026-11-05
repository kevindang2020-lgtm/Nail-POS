// Kysely (Postgres) barcode repo. Relies on the active-uniqueness partial index to prevent silent reassignment;
// addBarcode audits product_barcode_added. History is preserved (retire flips is_primary / sets retired_at).

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { BarcodeRepo, BarcodeRow } from './product-barcode.repository';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const mapRow = (r: any): BarcodeRow => ({
  id: r.id, masterProductId: r.master_product_id, barcode: r.barcode, barcodeType: r.barcode_type, isPrimary: !!r.is_primary,
  valid: !!r.valid, source: r.source, reason: r.reason, createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at) as string, retiredAt: iso(r.retired_at),
});

export class KyselyBarcodeRepo implements BarcodeRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async masterExists(id: string): Promise<boolean> {
    try { const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM product_master WHERE id = ${id}`.execute(this.db); return Number(r.rows[0]?.n ?? 0) > 0; } catch { return false; }
  }
  async listBarcodes(masterProductId: string): Promise<BarcodeRow[]> {
    try { const r = await sql<any>`SELECT * FROM product_barcodes WHERE master_product_id = ${masterProductId} ORDER BY created_at DESC`.execute(this.db); return r.rows.map(mapRow); } catch { return []; }
  }
  async activeHolder(barcode: string): Promise<string | null> {
    try { const r = await sql<any>`SELECT master_product_id FROM product_barcodes WHERE barcode = ${barcode} AND retired_at IS NULL AND valid = true LIMIT 1`.execute(this.db); return r.rows[0]?.master_product_id ?? null; } catch { return null; }
  }
  async retirePrimary(masterProductId: string): Promise<void> {
    try { await sql`UPDATE product_barcodes SET is_primary = false WHERE master_product_id = ${masterProductId} AND is_primary = true AND retired_at IS NULL`.execute(this.db); } catch { /* noop */ }
  }
  async addBarcode(input: { masterProductId: string; barcode: string; barcodeType: string; isPrimary: boolean; source: string; reason: string; createdByUserId: string | null }): Promise<BarcodeRow> {
    if (input.isPrimary) await this.retirePrimary(input.masterProductId);
    const ins = await sql<any>`
      INSERT INTO product_barcodes (master_product_id, barcode, barcode_type, is_primary, source, reason, created_by_user_id)
      VALUES (${input.masterProductId}, ${input.barcode}, ${input.barcodeType}, ${input.isPrimary}, ${input.source}, ${input.reason}, ${input.createdByUserId})
      RETURNING *`.execute(this.db);
    const row = mapRow(ins.rows[0]);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES ('product_barcode_added', 'product_master', ${input.masterProductId}, ${input.createdByUserId}, now())`.execute(this.db); } catch { /* best-effort */ }
    return row;
  }
}
