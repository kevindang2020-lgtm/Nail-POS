// Product import service. Stages and validates rows via the pure engine BEFORE anything is persisted, records an
// error queue, and supports approval (import valid rows) and idempotent retry of technically-retryable errors.
// Untrusted identifiers inside uploaded rows are never applied here.

import { classifyRows, preImportStatus, type ImportRowInput } from './product-import-core';
import type { ImportRepo, ImportJobRow, ImportErrorRow } from './product-import.repository';

export class ProductImportService {
  constructor(private readonly repo: ImportRepo) {}

  listJobs(scope: { status?: string; cap?: number } = {}) { return this.repo.listJobs(scope); }
  listErrors(scope: { jobId?: string; status?: string; cap?: number } = {}) { return this.repo.listErrors(scope); }
  openErrorCount() { return this.repo.openErrorCount(); }

  async createImport(input: { source?: string; filename?: string | null; rows: ImportRowInput[]; requireBarcode?: boolean; idempotencyKey?: string | null; createdByUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; job?: ImportJobRow; deduped?: boolean }> {
    if (!Array.isArray(input.rows)) return { ok: false, errors: ['No rows provided.'] };
    if (input.rows.length > 50000) return { ok: false, errors: ['Row count exceeds the import limit.'] };
    const c = classifyRows(input.rows, { requireBarcode: input.requireBarcode });
    const { job, deduped } = await this.repo.createJob({
      source: input.source || 'csv', filename: input.filename ?? null, status: preImportStatus(c),
      totalRows: c.total, validRows: c.valid, invalidRows: c.invalid,
      idempotencyKey: input.idempotencyKey ?? null, createdByUserId: input.createdByUserId ?? null,
      errors: c.errors,
    });
    return { ok: true, job, deduped };
  }

  async approveImport(id: string): Promise<{ ok: boolean; errors?: string[]; job?: ImportJobRow }> {
    const job = await this.repo.approveJob(id);
    if (!job) return { ok: false, errors: ['Import job not found.'] };
    return { ok: true, job };
  }

  async retryError(id: string): Promise<{ ok: boolean; errors?: string[]; error?: ImportErrorRow }> {
    const res = await this.repo.retryError(id);
    if (!res.ok) return { ok: false, errors: [res.reason === 'not_retryable' ? 'This error type is not technically retryable.' : 'Import error not found.'] };
    return { ok: true, error: res.error };
  }
}
