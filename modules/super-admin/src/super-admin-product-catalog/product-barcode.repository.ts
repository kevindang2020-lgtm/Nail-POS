// Repository for product barcode management. In-memory impl is stateful so add/correct, conflict detection, and
// primary-uniqueness are exercised without a database. History is preserved (rows retired, never removed).

export interface BarcodeRow {
  id: string; masterProductId: string; barcode: string; barcodeType: string; isPrimary: boolean; valid: boolean;
  source: string | null; reason: string | null; createdByUserId: string | null; createdAt: string; retiredAt: string | null;
}

export interface BarcodeRepo {
  masterExists(masterProductId: string): Promise<boolean>;
  listBarcodes(masterProductId: string): Promise<BarcodeRow[]>;
  /** Returns the master product id that currently holds this barcode active, if any (for conflict detection). */
  activeHolder(barcode: string): Promise<string | null>;
  addBarcode(input: { masterProductId: string; barcode: string; barcodeType: string; isPrimary: boolean; source: string; reason: string; createdByUserId: string | null }): Promise<BarcodeRow>;
  retirePrimary(masterProductId: string): Promise<void>;
}

let BSEQ = 1;

export class InMemoryBarcodeRepo implements BarcodeRepo {
  private masters: Set<string>;
  private rows: BarcodeRow[] = [];
  constructor(opts?: { masters?: string[] }) { this.masters = new Set(opts?.masters ?? ['PM-0001', 'PM-0002']); }

  async masterExists(id: string): Promise<boolean> { return this.masters.has(id); }
  async listBarcodes(masterProductId: string): Promise<BarcodeRow[]> {
    return this.rows.filter((r) => r.masterProductId === masterProductId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  async activeHolder(barcode: string): Promise<string | null> {
    const hit = this.rows.find((r) => r.barcode === barcode && !r.retiredAt && r.valid);
    return hit ? hit.masterProductId : null;
  }
  async retirePrimary(masterProductId: string): Promise<void> {
    for (const r of this.rows) if (r.masterProductId === masterProductId && r.isPrimary && !r.retiredAt) { r.isPrimary = false; }
  }
  async addBarcode(input: { masterProductId: string; barcode: string; barcodeType: string; isPrimary: boolean; source: string; reason: string; createdByUserId: string | null }): Promise<BarcodeRow> {
    if (input.isPrimary) await this.retirePrimary(input.masterProductId);
    const row: BarcodeRow = {
      id: `PBC-${String(BSEQ++).padStart(4, '0')}`, masterProductId: input.masterProductId, barcode: input.barcode,
      barcodeType: input.barcodeType, isPrimary: input.isPrimary, valid: true, source: input.source, reason: input.reason,
      createdByUserId: input.createdByUserId, createdAt: new Date().toISOString(), retiredAt: null,
    };
    this.rows.push(row);
    return row;
  }
}
