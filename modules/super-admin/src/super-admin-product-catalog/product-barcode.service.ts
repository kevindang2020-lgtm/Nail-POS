// Barcode management service. Validates format/checksum and reason via the engine, blocks silent reassignment of a
// barcode already active on another product, and records each change (add / correct) with history preserved.

import { validateBarcodeChange } from './product-barcode-core';
import type { BarcodeRepo, BarcodeRow } from './product-barcode.repository';

export class ProductBarcodeService {
  constructor(private readonly repo: BarcodeRepo) {}

  list(masterProductId: string) { return this.repo.listBarcodes(masterProductId); }

  async addBarcode(input: { masterProductId: string; barcode?: string; reason?: string; isPrimary?: boolean; source?: string; requireChecksum?: boolean; createdByUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; barcode?: BarcodeRow }> {
    if (!(await this.repo.masterExists(input.masterProductId))) return { ok: false, errors: ['Master product not found.'] };

    const v = validateBarcodeChange({ barcode: input.barcode, reason: input.reason, requireChecksum: input.requireChecksum });
    if (v.errors.length) return { ok: false, errors: v.errors };

    const holder = await this.repo.activeHolder(v.normalized);
    if (holder && holder !== input.masterProductId) {
      return { ok: false, errors: [`This barcode is already active on another product (${holder}). Reassigning it requires retiring it there first.`] };
    }

    const row = await this.repo.addBarcode({
      masterProductId: input.masterProductId, barcode: v.normalized, barcodeType: v.type,
      isPrimary: input.isPrimary === true, source: input.source || 'manual', reason: String(input.reason).trim(),
      createdByUserId: input.createdByUserId ?? null,
    });
    return { ok: true, barcode: row };
  }
}
