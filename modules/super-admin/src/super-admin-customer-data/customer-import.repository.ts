// Repository for customer import jobs + staged rows. The in-memory implementation simulates the import side effect
// (flipping valid rows to imported and assigning a synthetic customer id) so the approval/retry lifecycle is fully
// testable without a database; the Kysely implementation performs the real customers insert.

import type { ImportJob } from '@aipowersalon/api-contracts/platform';
export type { ImportJob };   // owned by packages/api-contracts (Constitution 13 §13)
import type { ImportJobStatus, ImportRowStatus, StagedRow } from './customer-import-core';

export interface StoredRow { rowNumber: number; dedupKey: string; status: ImportRowStatus; error: string | null; customerId: string | null }
export interface CreateJobInput { tenantId: string; branchId: string | null; source: string; filename: string | null; requestedByUserId: string | null }
export interface ImportAudit { actionType: string; jobId: string; tenantId: string; detail: Record<string, unknown>; actorUserId?: string; ip?: string }

export interface ImportRepo {
  createJob(input: CreateJobInput, staged: StagedRow[]): Promise<ImportJob>;
  getJob(id: string): Promise<ImportJob | null>;
  listJobs(scope: { tenantId?: string; status?: string }): Promise<ImportJob[]>;
  getRows(jobId: string): Promise<StoredRow[]>;
  setJobStatus(id: string, status: ImportJobStatus, patch?: Partial<ImportJob>): Promise<void>;
  importRows(jobId: string, rowNumbers: number[]): Promise<{ imported: number; failed: number }>;
  counts(scope: { tenantId?: string }): Promise<{ failedRows: number; importedRows: number; failedJobs: number }>;
  writeAudit(entry: ImportAudit): Promise<void>;
}

export class InMemoryImportRepo implements ImportRepo {
  private jobs: ImportJob[] = [];
  private rows = new Map<string, (StoredRow & { tenantId: string })[]>();
  private audit: ImportAudit[] = [];
  private seq = 0;

  async createJob(input: CreateJobInput, staged: StagedRow[]): Promise<ImportJob> {
    const id = `imp_${++this.seq}`;
    const now = new Date().toISOString();
    const summary = {
      totalRows: staged.length,
      validRows: staged.filter((r) => r.status === 'valid').length,
      invalidRows: staged.filter((r) => r.status === 'invalid').length,
    };
    const job: ImportJob = {
      id, tenantId: input.tenantId, branchId: input.branchId, source: input.source, filename: input.filename, status: 'pending',
      totalRows: summary.totalRows, validRows: summary.validRows, invalidRows: summary.invalidRows, importedRows: 0, failedRows: 0,
      requestedByUserId: input.requestedByUserId, approvedByUserId: null, rejectReason: null, createdAt: now, approvedAt: null, completedAt: null,
    };
    this.jobs.push(job);
    this.rows.set(id, staged.map((r) => ({ rowNumber: r.rowNumber, dedupKey: r.dedupKey, status: r.status, error: r.error, customerId: null, tenantId: input.tenantId })));
    return { ...job };
  }
  async getJob(id: string): Promise<ImportJob | null> { const j = this.jobs.find((x) => x.id === id); return j ? { ...j } : null; }
  async listJobs(scope: { tenantId?: string; status?: string }): Promise<ImportJob[]> {
    return this.jobs.filter((j) => (!scope.tenantId || j.tenantId === scope.tenantId) && (!scope.status || j.status === scope.status)).map((j) => ({ ...j }));
  }
  async getRows(jobId: string): Promise<StoredRow[]> { return (this.rows.get(jobId) || []).map((r) => ({ rowNumber: r.rowNumber, dedupKey: r.dedupKey, status: r.status, error: r.error, customerId: r.customerId })); }
  async setJobStatus(id: string, status: ImportJobStatus, patch: Partial<ImportJob> = {}): Promise<void> {
    const j = this.jobs.find((x) => x.id === id); if (!j) return; j.status = status; Object.assign(j, patch);
  }
  async importRows(jobId: string, rowNumbers: number[]): Promise<{ imported: number; failed: number }> {
    const rs = this.rows.get(jobId) || [];
    const set = new Set(rowNumbers);
    let imported = 0;
    for (const r of rs) {
      if (!set.has(r.rowNumber)) continue;
      if (r.status === 'imported') continue;          // idempotency: never re-import
      if (r.status === 'valid' || r.status === 'failed') { r.status = 'imported'; r.customerId = `cus_${jobId}_${r.rowNumber}`; r.error = null; imported++; }
    }
    const j = this.jobs.find((x) => x.id === jobId)!;
    j.importedRows = rs.filter((r) => r.status === 'imported').length;
    j.failedRows = rs.filter((r) => r.status === 'failed').length;
    return { imported, failed: j.failedRows };
  }
  async counts(scope: { tenantId?: string }): Promise<{ failedRows: number; importedRows: number; failedJobs: number }> {
    const js = this.jobs.filter((j) => !scope.tenantId || j.tenantId === scope.tenantId);
    return {
      failedRows: js.reduce((a, j) => a + j.failedRows, 0),
      importedRows: js.reduce((a, j) => a + j.importedRows, 0),
      failedJobs: js.filter((j) => j.status === 'failed').length,
    };
  }
  async writeAudit(entry: ImportAudit): Promise<void> { this.audit.push({ ...entry }); }
  getAudit(): ImportAudit[] { return [...this.audit]; }
}
