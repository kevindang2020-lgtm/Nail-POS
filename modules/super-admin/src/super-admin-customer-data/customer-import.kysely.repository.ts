// Kysely (Postgres) implementation of the import repo. Jobs + staged rows live in the migration-173 tables; on
import { safeInet } from '@aipowersalon/database';   // INET column: a raw proxy-chain ip would throw and the row would be lost
// import, valid rows are inserted into `customers` (tenant + branch scoped) and the staged row is flipped to
// imported with the new customer id. Idempotent: only rows still 'valid'/'failed' are imported, and the per-job
// dedup unique index prevents double-staging. Exercised via ops/smoke, not the offline unit suite.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ImportJobStatus } from './customer-import-core';
import type { ImportRepo, ImportJob, StoredRow, CreateJobInput, ImportAudit } from './customer-import.repository';
import type { StagedRow } from './customer-import-core';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { CUSTOMER_IMPORT_JOB, CUSTOMER_IMPORT_ROW } from '../lifecycles';

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : d == null ? '' : String(d));
const isoN = (d: unknown): string | null => (d == null ? null : iso(d));

function mapJob(r: any): ImportJob {
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id, source: r.source, filename: r.filename, status: r.status,
    totalRows: Number(r.total_rows), validRows: Number(r.valid_rows), invalidRows: Number(r.invalid_rows), importedRows: Number(r.imported_rows), failedRows: Number(r.failed_rows),
    requestedByUserId: r.requested_by_user_id, approvedByUserId: r.approved_by_user_id, rejectReason: r.reject_reason,
    createdAt: iso(r.created_at), approvedAt: isoN(r.approved_at), completedAt: isoN(r.completed_at),
  };
}

export class KyselyImportRepo implements ImportRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async createJob(input: CreateJobInput, staged: StagedRow[]): Promise<ImportJob> {
    const valid = staged.filter((r) => r.status === 'valid').length;
    const invalid = staged.filter((r) => r.status === 'invalid').length;
    const jobRes = await sql<any>`
      INSERT INTO customer_import_jobs (tenant_id, branch_id, source, filename, status, total_rows, valid_rows, invalid_rows, requested_by_user_id)
      VALUES (${input.tenantId}, ${input.branchId}, ${input.source}, ${input.filename}, 'pending', ${staged.length}, ${valid}, ${invalid}, ${input.requestedByUserId})
      RETURNING *`.execute(this.db);
    const job = mapJob(jobRes.rows[0]);
    for (const r of staged) {
      await sql`
        INSERT INTO customer_import_rows (job_id, tenant_id, row_number, raw_json, dedup_key, status, error)
        VALUES (${job.id}, ${input.tenantId}, ${r.rowNumber}, ${JSON.stringify(r.raw)}::jsonb, ${r.dedupKey}, ${r.status}, ${r.error})
        ON CONFLICT (job_id, dedup_key) DO NOTHING`.execute(this.db);
    }
    return job;
  }
  async getJob(id: string): Promise<ImportJob | null> {
    const res = await sql<any>`SELECT * FROM customer_import_jobs WHERE id = ${id} LIMIT 1`.execute(this.db);
    return res.rows[0] ? mapJob(res.rows[0]) : null;
  }
  async listJobs(scope: { tenantId?: string; status?: string }): Promise<ImportJob[]> {
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    const s = scope.status ? sql`AND status = ${scope.status}` : sql``;
    const res = await sql<any>`SELECT * FROM customer_import_jobs WHERE 1=1 ${t} ${s} ORDER BY created_at DESC LIMIT 200`.execute(this.db);
    return res.rows.map(mapJob);
  }
  async getRows(jobId: string): Promise<StoredRow[]> {
    const res = await sql<any>`SELECT row_number, dedup_key, status, error, customer_id FROM customer_import_rows WHERE job_id = ${jobId} ORDER BY row_number`.execute(this.db);
    return res.rows.map((r) => ({ rowNumber: Number(r.row_number), dedupKey: r.dedup_key, status: r.status, error: r.error, customerId: r.customer_id }));
  }
  async setJobStatus(id: string, status: ImportJobStatus, patch: Partial<ImportJob> = {}): Promise<void> {
    const moved = await sql`
      UPDATE customer_import_jobs SET status = ${status},
        approved_by_user_id = COALESCE(${patch.approvedByUserId ?? null}, approved_by_user_id),
        approved_at = COALESCE(${patch.approvedAt ?? null}, approved_at),
        completed_at = COALESCE(${patch.completedAt ?? null}, completed_at),
        reject_reason = COALESCE(${patch.rejectReason ?? null}, reject_reason),
        updated_at = now()
      WHERE id = ${id} AND ${canMoveToSql(CUSTOMER_IMPORT_JOB, status)}
      RETURNING id`.execute(this.db);
    // Phase 12 (#27): a job another worker / admin already moved is refused (409), never re-claimed
    if (!moved.rows.length && (await this.getJob(id))) throw new InvalidStateTransitionError(CUSTOMER_IMPORT_JOB, null, status, 'concurrent');
  }
  async importRows(jobId: string, rowNumbers: number[]): Promise<{ imported: number; failed: number }> {
    if (rowNumbers.length === 0) return { imported: 0, failed: 0 };
    const job = await this.getJob(jobId);
    if (!job) return { imported: 0, failed: 0 };
    const rows = await sql<any>`
      SELECT id, row_number, raw_json, status FROM customer_import_rows
      WHERE job_id = ${jobId} AND row_number = ANY(${rowNumbers}) AND status IN ('valid','failed')`.execute(this.db);
    let imported = 0;
    for (const r of rows.rows) {
      const raw = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : (r.raw_json || {});
      if (!job.branchId) { await sql`UPDATE customer_import_rows SET status='failed', error='Import job has no branch', updated_at=now() WHERE id=${r.id} AND ${canMoveToSql(CUSTOMER_IMPORT_ROW, 'failed')}`.execute(this.db); continue; }
      try {
        const fn = String(raw.firstName ?? '').trim(); const ln = String(raw.lastName ?? '').trim();
        const full = `${fn} ${ln}`.trim();
        // Phase 12 (#27): the customer insert and the row's move to 'imported' commit together, and the move is
        // conditional (CUSTOMER_IMPORT_ROW: only from valid / failed) — an overlapping run that imported this row first
        // makes this one roll its customer back instead of creating a duplicate
        await this.db.transaction().execute(async (trx) => {
          const ins = await sql<any>`
            INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, status)
            VALUES (${job.tenantId}, ${job.branchId}, ${fn}, ${ln}, ${full}, ${raw.phone ?? null}, ${raw.phone ?? null}, ${raw.email ?? null}, 'active')
            RETURNING id`.execute(trx);
          const moved = await sql<any>`UPDATE customer_import_rows SET status='imported', customer_id=${ins.rows[0].id}, error=NULL, attempts=attempts+1, updated_at=now() WHERE id=${r.id} AND ${canMoveToSql(CUSTOMER_IMPORT_ROW, 'imported')} RETURNING id`.execute(trx);
          if (!moved.rows.length) throw new InvalidStateTransitionError(CUSTOMER_IMPORT_ROW, 'imported', 'imported', 'concurrent');
        });
        imported++;
      } catch (e: any) {
        if (e instanceof InvalidStateTransitionError) continue;   // imported by the other run — nothing to record
        await sql`UPDATE customer_import_rows SET status='failed', error=${String(e?.message || 'import failed').slice(0, 300)}, attempts=attempts+1, updated_at=now() WHERE id=${r.id} AND ${canMoveToSql(CUSTOMER_IMPORT_ROW, 'failed')}`.execute(this.db);
      }
    }
    const agg = await sql<any>`SELECT count(*) FILTER (WHERE status='imported')::int AS imp, count(*) FILTER (WHERE status='failed')::int AS fail FROM customer_import_rows WHERE job_id=${jobId}`.execute(this.db);
    await sql`UPDATE customer_import_jobs SET imported_rows=${Number(agg.rows[0].imp)}, failed_rows=${Number(agg.rows[0].fail)}, updated_at=now() WHERE id=${jobId}`.execute(this.db);
    return { imported, failed: Number(agg.rows[0].fail) };
  }
  async counts(scope: { tenantId?: string }): Promise<{ failedRows: number; importedRows: number; failedJobs: number }> {
    const t = scope.tenantId ? sql`AND tenant_id = ${scope.tenantId}` : sql``;
    const res = await sql<any>`
      SELECT COALESCE(sum(failed_rows),0)::int AS failed_rows, COALESCE(sum(imported_rows),0)::int AS imported_rows,
             count(*) FILTER (WHERE status='failed')::int AS failed_jobs
      FROM customer_import_jobs WHERE 1=1 ${t}`.execute(this.db);
    const r = res.rows[0]; return { failedRows: Number(r.failed_rows), importedRows: Number(r.imported_rows), failedJobs: Number(r.failed_jobs) };
  }
  async writeAudit(entry: ImportAudit): Promise<void> {
    await sql`
      INSERT INTO audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
      VALUES (${entry.tenantId}, ${entry.actorUserId ?? null}, 'SUPER_ADMIN', ${entry.actionType}, 'customer_import_job', ${entry.jobId}, ${safeInet(entry.ip)},
        ${JSON.stringify({ ...entry.detail, source: 'customer_data_oversight_import' })}::jsonb)`.execute(this.db);
  }
}
