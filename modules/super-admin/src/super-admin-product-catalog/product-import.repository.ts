// Repository for the product import pipeline (jobs + error queue). In-memory impl is stateful so create/approve/retry
// and idempotency are exercised without a database.

export interface ImportJobRow {
  id: string; source: string; filename: string | null; status: string;
  totalRows: number; validRows: number; invalidRows: number; importedRows: number; failedRows: number;
  errorSummary: string | null; createdByUserId: string | null; createdAt: string; approvedAt: string | null; completedAt: string | null;
}
export interface ImportErrorRow {
  id: string; jobId: string; rowNumber: number | null; errorType: string; productName: string | null;
  sourceFile: string | null; detail: string | null; status: string; retryable: boolean; createdAt: string;
}
export interface CreateJobInput {
  source: string; filename: string | null; status: string; totalRows: number; validRows: number; invalidRows: number;
  idempotencyKey?: string | null; createdByUserId?: string | null;
  errors: { rowNumber: number; name: string | null; errorType: string; retryable: boolean }[];
}

export interface ImportRepo {
  listJobs(scope: { status?: string; cap?: number }): Promise<ImportJobRow[]>;
  listErrors(scope: { jobId?: string; status?: string; cap?: number }): Promise<ImportErrorRow[]>;
  openErrorCount(): Promise<number>;
  createJob(input: CreateJobInput): Promise<{ job: ImportJobRow; deduped: boolean }>;
  approveJob(id: string): Promise<ImportJobRow | null>;
  retryError(id: string): Promise<{ ok: boolean; error?: ImportErrorRow; reason?: string }>;
}

let JSEQ = 1, ESEQ = 1;

export class InMemoryImportRepo implements ImportRepo {
  private jobs: ImportJobRow[] = [];
  private errors: ImportErrorRow[] = [];

  async listJobs(scope: { status?: string; cap?: number }): Promise<ImportJobRow[]> {
    let r = [...this.jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (scope.status) r = r.filter((j) => j.status === scope.status);
    return r.slice(0, scope.cap ?? 200);
  }
  async listErrors(scope: { jobId?: string; status?: string; cap?: number }): Promise<ImportErrorRow[]> {
    let r = [...this.errors].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (scope.jobId) r = r.filter((e) => e.jobId === scope.jobId);
    if (scope.status) r = r.filter((e) => e.status === scope.status);
    return r.slice(0, scope.cap ?? 200);
  }
  async openErrorCount(): Promise<number> { return this.errors.filter((e) => e.status === 'open' || e.status === 'retrying').length; }

  async createJob(input: CreateJobInput): Promise<{ job: ImportJobRow; deduped: boolean }> {
    if (input.idempotencyKey) {
      const existing = this.jobs.find((j) => j.errorSummary !== undefined && (j as any).idempotencyKey === input.idempotencyKey);
      if (existing) return { job: existing, deduped: true };
    }
    const now = new Date().toISOString();
    const job: ImportJobRow & { idempotencyKey?: string | null } = {
      id: `PIMP-${String(JSEQ++).padStart(4, '0')}`, source: input.source, filename: input.filename, status: input.status,
      totalRows: input.totalRows, validRows: input.validRows, invalidRows: input.invalidRows, importedRows: 0, failedRows: 0,
      errorSummary: input.errors.length ? `${input.errors.length} row error(s)` : null,
      createdByUserId: input.createdByUserId ?? null, createdAt: now, approvedAt: null, completedAt: null,
      idempotencyKey: input.idempotencyKey ?? null,
    };
    this.jobs.push(job);
    for (const e of input.errors) {
      this.errors.push({ id: `PIERR-${String(ESEQ++).padStart(4, '0')}`, jobId: job.id, rowNumber: e.rowNumber, errorType: e.errorType, productName: e.name, sourceFile: input.filename, detail: null, status: 'open', retryable: e.retryable, createdAt: now });
    }
    return { job, deduped: false };
  }

  async approveJob(id: string): Promise<ImportJobRow | null> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return null;
    if (job.status === 'imported' || job.status === 'partially_imported') return job; // idempotent
    job.importedRows = job.validRows;
    job.failedRows = job.invalidRows;
    job.status = job.importedRows > 0 && job.failedRows === 0 ? 'imported' : job.importedRows > 0 ? 'partially_imported' : 'failed';
    job.approvedAt = new Date().toISOString();
    job.completedAt = job.approvedAt;
    return job;
  }

  async retryError(id: string): Promise<{ ok: boolean; error?: ImportErrorRow; reason?: string }> {
    const err = this.errors.find((e) => e.id === id);
    if (!err) return { ok: false, reason: 'not_found' };
    if (!err.retryable) return { ok: false, reason: 'not_retryable' };
    if (err.status === 'resolved') return { ok: true, error: err }; // idempotent
    err.status = 'resolved';
    return { ok: true, error: err };
  }
}
