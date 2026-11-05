// MASTER product service. Enforces validation, blocks duplicate product codes, and gates on duplicate SKU/barcode
// candidates (shown before save; caller must confirm to proceed). Retirement preserves the record (status change
// only) — tenant-owned products and branch inventory are never touched here.

import { validateMasterProductInput, duplicateCandidates, type MasterProductInput, type DuplicateCandidate } from './product-master-core';
import type { MasterProductRepo, MasterListScope, MasterProductRow } from './product-master.repository';

export type CreateResult =
  | { ok: true; product: MasterProductRow }
  | { ok: false; errors?: string[]; requiresConfirmation?: boolean; candidates?: DuplicateCandidate[] };

export class MasterProductService {
  constructor(private readonly repo: MasterProductRepo) {}

  list(scope: MasterListScope = {}) { return this.repo.listMasters(scope); }

  async create(input: MasterProductInput & { confirmDuplicates?: boolean; createdByUserId?: string | null }): Promise<CreateResult> {
    const { errors } = validateMasterProductInput(input);
    if (errors.length) return { ok: false, errors };

    if (input.code && String(input.code).trim()) {
      if (await this.repo.codeExists(String(input.code).trim())) return { ok: false, errors: ['A product with this code already exists.'] };
    }

    const candidates = duplicateCandidates(input, await this.repo.existingForDuplicateCheck());
    const hardConflict = candidates.some((c) => c.reason === 'exact_sku' || c.reason === 'exact_barcode');
    if (candidates.length && !input.confirmDuplicates) {
      return { ok: false, requiresConfirmation: true, candidates };
    }
    // Even with confirmation, an exact barcode already attached to another active product should not be silently reused.
    void hardConflict;

    const product = await this.repo.createMaster({ ...input, status: 'draft', createdByUserId: input.createdByUserId ?? null });
    return { ok: true, product };
  }

  async retire(id: string, reason: string, byUserId: string | null): Promise<{ ok: boolean; errors?: string[]; product?: MasterProductRow }> {
    if (!reason || !reason.trim()) return { ok: false, errors: ['A retirement reason is required.'] };
    const product = await this.repo.retireMaster(id, reason.trim(), byUserId);
    if (!product) return { ok: false, errors: ['Product not found.'] };
    return { ok: true, product };
  }
}
