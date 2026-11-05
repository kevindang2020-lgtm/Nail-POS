// Customer Import service. Orchestrates the staging → approval → import → retry lifecycle on top of the pure engine
// and the repo. Approve and retry are idempotent (the repo never re-imports an already-imported row), and every
// state change is audited. counts() feeds the Failed Imports KPI and the Import Success chart in the overview.

import { stageRows, summarizeJob, canApprove, canRetry, importSuccessRate, type RawImportRow } from './customer-import-core';
import type { ImportRepo, ImportJob } from './customer-import.repository';

export interface ImportActor { userId?: string; ip?: string }
export interface CreateJobArgs { tenantId?: string; branchId?: string | null; source?: string; filename?: string | null; rows?: RawImportRow[] }
export interface JobResult { ok: boolean; errors?: string[]; job?: ImportJob }

export class CustomerImportService {
  constructor(private readonly repo: ImportRepo) {}

  async createJob(args: CreateJobArgs, actor: ImportActor = {}): Promise<JobResult> {
    if (!args.tenantId) return { ok: false, errors: ['A tenant is required.'] };
    const rows = args.rows || [];
    if (rows.length === 0) return { ok: false, errors: ['No rows to import.'] };
    const staged = stageRows(args.tenantId, rows);
    const job = await this.repo.createJob(
      { tenantId: args.tenantId, branchId: args.branchId ?? null, source: args.source || 'csv', filename: args.filename ?? null, requestedByUserId: actor.userId ?? null },
      staged,
    );
    await this.repo.writeAudit({ actionType: 'customer_import_staged', jobId: job.id, tenantId: job.tenantId, detail: { total: job.totalRows, valid: job.validRows, invalid: job.invalidRows }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, job };
  }

  async approveJob(id: string, actor: ImportActor = {}): Promise<JobResult> {
    const job = await this.repo.getJob(id);
    if (!job) return { ok: false, errors: ['Import job not found.'] };
    const rows = await this.repo.getRows(id);
    const gate = canApprove(job.status, summarizeJob(rows));
    if (!gate.ok) return { ok: false, errors: [gate.reason!] };
    // Enqueue only — set the job to 'approved' (queued) and return immediately. The actual row import is done by the
    // background worker (processPendingImportJobs), so approving a large import (tens of thousands of rows at scale)
    // never blocks the request. Import remains idempotent, so a crashed worker simply re-processes safely.
    await this.repo.setJobStatus(id, 'approved', { approvedByUserId: actor.userId ?? null, approvedAt: new Date().toISOString() });
    await this.repo.writeAudit({ actionType: 'customer_import_approved', jobId: id, tenantId: job.tenantId, detail: { queued: true }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, job: (await this.repo.getJob(id))! };
  }

  /**
   * Background worker entry point: process up to `batch` queued ('approved') import jobs, importing their valid rows
   * and marking each completed. Idempotent (the repo never re-imports an already-imported row), so it's safe to call
   * repeatedly and safe to re-run after a crash mid-job. Called by CustomerImportScheduler and by the manual
   * ops trigger. Returns how many jobs it advanced.
   */
  async processPendingImportJobs(batch = 5): Promise<{ processed: number }> {
    const queued = await this.repo.listJobs({ status: 'approved' });
    let processed = 0;
    for (const job of queued.slice(0, Math.max(1, batch))) {
      try {
        await this.repo.setJobStatus(job.id, 'processing');
        const rows = await this.repo.getRows(job.id);
        const toImport = rows.filter((r) => r.status === 'valid' || r.status === 'failed').map((r) => r.rowNumber);
        const res = await this.repo.importRows(job.id, toImport);
        await this.repo.setJobStatus(job.id, 'completed', { completedAt: new Date().toISOString() });
        await this.repo.writeAudit({ actionType: 'customer_import_processed', jobId: job.id, tenantId: job.tenantId, detail: { imported: res.imported, failed: res.failed } });
        processed++;
      } catch {
        // Leave the job in 'processing'; the next tick's idempotent re-run will complete it. Never throw — a bad job
        // must not stop the batch or crash the worker.
      }
    }
    return { processed };
  }

  async retryJob(id: string, actor: ImportActor = {}): Promise<JobResult> {
    const job = await this.repo.getJob(id);
    if (!job) return { ok: false, errors: ['Import job not found.'] };
    const rows = await this.repo.getRows(id);
    const gate = canRetry(job.status, rows);
    if (!gate.ok) return { ok: false, errors: [gate.reason!] };
    await this.repo.setJobStatus(id, 'processing');
    const res = await this.repo.importRows(id, gate.retryRowNumbers);
    await this.repo.setJobStatus(id, 'completed', { completedAt: new Date().toISOString() });
    await this.repo.writeAudit({ actionType: 'customer_import_retried', jobId: id, tenantId: job.tenantId, detail: { imported: res.imported, failed: res.failed }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, job: (await this.repo.getJob(id))! };
  }

  async rejectJob(id: string, reason: string | undefined, actor: ImportActor = {}): Promise<JobResult> {
    const job = await this.repo.getJob(id);
    if (!job) return { ok: false, errors: ['Import job not found.'] };
    if (job.status !== 'pending') return { ok: false, errors: ['Only a pending job can be rejected.'] };
    if (!reason || !reason.trim()) return { ok: false, errors: ['A rejection reason is required.'] };
    await this.repo.setJobStatus(id, 'rejected', { rejectReason: reason.trim() });
    await this.repo.writeAudit({ actionType: 'customer_import_rejected', jobId: id, tenantId: job.tenantId, detail: { reason: reason.trim() }, actorUserId: actor.userId, ip: actor.ip });
    return { ok: true, job: (await this.repo.getJob(id))! };
  }

  listJobs(scope: { tenantId?: string; status?: string }) { return this.repo.listJobs(scope); }

  /** Feeds the overview: failed-import count + overall import success rate. */
  async overviewStats(scope: { tenantId?: string }): Promise<{ failedImports: number; successRatePct: number | null }> {
    const c = await this.repo.counts(scope);
    return { failedImports: c.failedRows, successRatePct: importSuccessRate({ totalRows: 0, validRows: 0, invalidRows: 0, importedRows: c.importedRows, failedRows: c.failedRows }) };
  }
}
