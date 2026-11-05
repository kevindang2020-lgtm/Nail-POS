// Kysely (Postgres) implementation of the import repo. createJob honors the idempotency unique index; approveJob and
// retryError are idempotent. Staging inserts go to product_import_jobs / product_import_errors — never product_master.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ImportRepo, ImportJobRow, ImportErrorRow, CreateJobInput } from './product-import.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { PRODUCT_IMPORT_JOB, PRODUCT_IMPORT_ERROR } from '../lifecycles';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const jobRow = (r: any): ImportJobRow => ({
  id: r.id, source: r.source, filename: r.filename, status: r.status, totalRows: Number(r.total_rows), validRows: Number(r.valid_rows),
  invalidRows: Number(r.invalid_rows), importedRows: Number(r.imported_rows), failedRows: Number(r.failed_rows), errorSummary: r.error_summary,
  createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at) as string, approvedAt: iso(r.approved_at), completedAt: iso(r.completed_at),
});
const errRow = (r: any): ImportErrorRow => ({
  id: r.id, jobId: r.job_id, rowNumber: r.row_number == null ? null : Number(r.row_number), errorType: r.error_type, productName: r.product_name,
  sourceFile: r.source_file, detail: r.detail, status: r.status, retryable: !!r.retryable, createdAt: iso(r.created_at) as string,
});

export class KyselyImportRepo implements ImportRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async listJobs(scope: { status?: string; cap?: number }): Promise<ImportJobRow[]> {
    const st = scope.status ? sql`AND status = ${scope.status}` : sql``;
    try { const res = await sql<any>`SELECT * FROM product_import_jobs WHERE 1=1 ${st} ORDER BY created_at DESC LIMIT ${Math.min(500, scope.cap ?? 200)}`.execute(this.db); return res.rows.map(jobRow); } catch { return []; }
  }
  async listErrors(scope: { jobId?: string; status?: string; cap?: number }): Promise<ImportErrorRow[]> {
    const j = scope.jobId ? sql`AND job_id = ${scope.jobId}` : sql``;
    const st = scope.status ? sql`AND status = ${scope.status}` : sql``;
    try { const res = await sql<any>`SELECT * FROM product_import_errors WHERE 1=1 ${j} ${st} ORDER BY created_at DESC LIMIT ${Math.min(500, scope.cap ?? 200)}`.execute(this.db); return res.rows.map(errRow); } catch { return []; }
  }
  async openErrorCount(): Promise<number> {
    try { const res = await sql<{ n: number }>`SELECT count(*)::int AS n FROM product_import_errors WHERE status IN ('open','retrying')`.execute(this.db); return Number(res.rows[0]?.n ?? 0); } catch { return 0; }
  }

  async createJob(input: CreateJobInput): Promise<{ job: ImportJobRow; deduped: boolean }> {
    if (input.idempotencyKey) {
      const existing = await sql<any>`SELECT * FROM product_import_jobs WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1`.execute(this.db);
      if (existing.rows[0]) return { job: jobRow(existing.rows[0]), deduped: true };
    }
    const ins = await sql<any>`
      INSERT INTO product_import_jobs (source, filename, status, total_rows, valid_rows, invalid_rows, error_summary, idempotency_key, created_by_user_id)
      VALUES (${input.source}, ${input.filename}, ${input.status}, ${input.totalRows}, ${input.validRows}, ${input.invalidRows},
              ${input.errors.length ? `${input.errors.length} row error(s)` : null}, ${input.idempotencyKey ?? null}, ${input.createdByUserId ?? null})
      RETURNING *`.execute(this.db);
    const job = jobRow(ins.rows[0]);
    for (const e of input.errors) {
      await sql`INSERT INTO product_import_errors (job_id, row_number, error_type, product_name, source_file, retryable)
                VALUES (${job.id}, ${e.rowNumber}, ${e.errorType}, ${e.name}, ${input.filename}, ${e.retryable})`.execute(this.db);
    }
    return { job, deduped: false };
  }

  async approveJob(id: string): Promise<ImportJobRow | null> {
    const res = await sql<any>`
      UPDATE product_import_jobs SET
        imported_rows = valid_rows, failed_rows = invalid_rows,
        status = CASE WHEN valid_rows > 0 AND invalid_rows = 0 THEN 'imported' WHEN valid_rows > 0 THEN 'partially_imported' ELSE 'failed' END,
        approved_at = COALESCE(approved_at, now()), completed_at = now()
      WHERE id = ${id} AND ${canMoveToSql(PRODUCT_IMPORT_JOB, 'imported')} RETURNING *`.execute(this.db);
    if (res.rows[0]) return jobRow(res.rows[0]);
    const cur = await sql<any>`SELECT * FROM product_import_jobs WHERE id = ${id} LIMIT 1`.execute(this.db);
    return cur.rows[0] ? jobRow(cur.rows[0]) : null; // idempotent: already-approved returns current state
  }

  async retryError(id: string): Promise<{ ok: boolean; error?: ImportErrorRow; reason?: string }> {
    const cur = await sql<any>`SELECT * FROM product_import_errors WHERE id = ${id} LIMIT 1`.execute(this.db);
    if (!cur.rows[0]) return { ok: false, reason: 'not_found' };
    if (!cur.rows[0].retryable) return { ok: false, reason: 'not_retryable' };
    const res = await sql<any>`UPDATE product_import_errors SET status = 'resolved' WHERE id = ${id} AND ${canMoveToSql(PRODUCT_IMPORT_ERROR, 'resolved')} RETURNING *`.execute(this.db);
    return { ok: true, error: errRow(res.rows[0] ?? cur.rows[0]) };
  }
}
