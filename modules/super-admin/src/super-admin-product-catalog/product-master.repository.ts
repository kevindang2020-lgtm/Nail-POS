// Repository for the platform MASTER product catalog (product_master). In-memory impl is stateful so create/retire
// are exercised without a database. Money is integer cents.

import { normalizeSku, normalizeName, type MasterProductInput, type ExistingMaster } from './product-master-core';

export interface MasterProductRow {
  id: string; code: string | null; name: string; brandName: string | null; sku: string | null; normalizedSku: string | null;
  upc: string | null; barcode: string | null; categoryName: string | null; costCents: number | null;
  suggestedRetailCents: number | null; currency: string; taxCategory: string | null; inventoryUnit: string;
  vendorName: string | null; status: string; optionalProduct: boolean; createdByUserId: string | null;
  retiredAt: string | null; createdAt: string;
}

export interface MasterListScope { status?: string; search?: string; cap?: number }

export interface MasterProductRepo {
  listMasters(scope: MasterListScope): Promise<MasterProductRow[]>;
  existingForDuplicateCheck(): Promise<ExistingMaster[]>;
  codeExists(code: string): Promise<boolean>;
  createMaster(input: MasterProductInput & { status?: string; createdByUserId?: string | null }): Promise<MasterProductRow>;
  retireMaster(id: string, reason: string, byUserId: string | null): Promise<MasterProductRow | null>;
}

let SEQ = 1;

export class InMemoryMasterProductRepo implements MasterProductRepo {
  private store: MasterProductRow[] = [];

  async listMasters(scope: MasterListScope): Promise<MasterProductRow[]> {
    let rows = this.store;
    if (scope.status) rows = rows.filter((r) => r.status === scope.status);
    if (scope.search) { const q = scope.search.toLowerCase(); rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.sku || '').toLowerCase().includes(q) || (r.barcode || '').includes(q)); }
    return rows.slice(0, scope.cap ?? 500);
  }
  async existingForDuplicateCheck(): Promise<ExistingMaster[]> {
    return this.store.map((r) => ({ id: r.id, name: r.name, normalizedSku: r.normalizedSku, barcode: r.barcode || r.upc, brandName: r.brandName, normalizedName: normalizeName(r.name) }));
  }
  async codeExists(code: string): Promise<boolean> { return this.store.some((r) => r.code === code); }

  async createMaster(input: MasterProductInput & { status?: string; createdByUserId?: string | null }): Promise<MasterProductRow> {
    const row: MasterProductRow = {
      id: `PM-${String(SEQ++).padStart(4, '0')}`, code: input.code ?? null, name: String(input.name), brandName: input.brandName ?? null,
      sku: input.sku ?? null, normalizedSku: normalizeSku(input.sku), upc: input.upc ?? null, barcode: input.barcode ?? null,
      categoryName: input.categoryName ?? null, costCents: input.costCents ?? null, suggestedRetailCents: input.suggestedRetailCents ?? null,
      currency: input.currency ?? 'USD', taxCategory: input.taxCategory ?? null, inventoryUnit: input.inventoryUnit ?? 'each',
      vendorName: input.vendorName ?? null, status: input.status ?? 'draft', optionalProduct: true,
      createdByUserId: input.createdByUserId ?? null, retiredAt: null, createdAt: new Date().toISOString(),
    };
    this.store.push(row);
    return row;
  }
  async retireMaster(id: string, reason: string, byUserId: string | null): Promise<MasterProductRow | null> {
    const row = this.store.find((r) => r.id === id);
    if (!row) return null;
    row.status = 'retired'; row.retiredAt = new Date().toISOString();
    void reason; void byUserId;
    return row;
  }
}
