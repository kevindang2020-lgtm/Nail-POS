// legacy-export-jobs.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the two background exports that existed before the
// ONE async contract — Super Admin billing exports (billing_export_jobs, migration 200) and revenue-residual export jobs
// (revenue_export_jobs, migration 227) — read through it, so there is one status shape and one download route.
//
// Their own create / poll routes keep working unchanged (the admin screens use them); in addition each job IS an
// operation: GET /super-admin/operations/<job id> answers an AsyncOperationStatus for it and
// GET /super-admin/operations/<job id>/download hands the file over — to the platform user who queued it, or one holding
// the job's own key (billing: super_admin.billing.view; revenue residuals: super_admin.payments.view).
import { sql } from 'kysely';
import { decide } from '@aipowersalon/permissions';
import { principalOfRequest } from '@aipowersalon/permissions/guards';
import { operationDownloadPath, type AsyncOperationStatus } from '@aipowersalon/api-contracts';
import { isUuid } from './async-export.core';

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : undefined);
type Legacy = { kind: string; permission: string; status: AsyncOperationStatus['status']; actor: string | null; createdAt: string; finishedAt?: string;
  expiresAt?: string; filename?: string; contentType?: string; content?: Buffer; rows?: number; error?: string };

/** billing_export_jobs.status / revenue_export_jobs.status → the contract's states. */
export function legacyState(table: 'billing' | 'revenue', s: string, expired: boolean): AsyncOperationStatus['status'] {
  const v = String(s || '').toLowerCase();
  if (table === 'billing') return v === 'pending' ? 'queued' : v === 'processing' ? 'running' : v === 'ready' ? (expired ? 'expired' : 'succeeded') : v === 'expired' ? 'expired' : 'failed';
  return v === 'queued' ? 'queued' : v === 'running' ? 'running' : v === 'completed' ? 'succeeded' : 'failed';
}

export class LegacyExportJobs {
  // B-18 (Oct 22 2026): a job completed since migration 677 holds a private-store KEY (content_key); older rows hold the bytes
  constructor(private readonly db: any, private readonly store: { get(key: string): Promise<Buffer | null> } | null = null) {}

  private async load(id: string): Promise<Legacy | null> {
    if (!this.db || !isUuid(id)) return null;
    const b: any = (await sql`select status, filename, content_type, content_b64, content_key, row_count, error, created_by_user_id, created_at, completed_at, expires_at,
        (expires_at is not null and expires_at < now()) as is_expired from billing_export_jobs where id = ${id}`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    if (b) return {
      kind: 'super-admin.billing.export-job', permission: 'super_admin.billing.view', status: legacyState('billing', b.status, !!b.is_expired),
      actor: b.created_by_user_id ? String(b.created_by_user_id) : null, createdAt: iso(b.created_at)!, finishedAt: iso(b.completed_at), expiresAt: iso(b.expires_at),
      filename: b.filename ?? undefined, contentType: b.content_type ?? undefined,
      content: b.content_key ? ((await this.store?.get(String(b.content_key))) ?? undefined) : b.content_b64 ? Buffer.from(String(b.content_b64), 'base64') : undefined,
      rows: b.row_count ?? undefined, error: b.error ?? undefined,
    };
    const r: any = (await sql`select status, filename, mime, encoding, content, content_key, row_count, error, requested_by, created_at, completed_at
        from revenue_export_jobs where id = ${id}`.execute(this.db).catch(() => ({ rows: [] }))).rows[0];
    if (r) return {
      kind: 'super-admin.revenue-residuals.export-job', permission: 'super_admin.payments.view', status: legacyState('revenue', r.status, false),
      actor: r.requested_by ? String(r.requested_by) : null, createdAt: iso(r.created_at)!, finishedAt: iso(r.completed_at),
      filename: r.filename ?? undefined, contentType: r.mime ?? undefined,
      content: r.content_key ? ((await this.store?.get(String(r.content_key))) ?? undefined) : typeof r.content === 'string' ? Buffer.from(r.content, String(r.encoding ?? '').toLowerCase() === 'base64' ? 'base64' : 'utf8') : undefined,
      rows: r.row_count ?? undefined, error: r.error ?? undefined,
    };
    return null;
  }

  private readable(ctx: any, j: Legacy): boolean {
    if (ctx?.role !== 'SUPER_ADMIN') return false;
    if (j.actor && j.actor === String(ctx.userId ?? '')) return true;
    return decide(principalOfRequest(ctx), j.permission).allowed;
  }

  /** null = not a legacy job this person may see (the caller answers 404). */
  async status(ctx: any, id: string): Promise<AsyncOperationStatus | null> {
    const j = await this.load(id);
    if (!j || !this.readable(ctx, j)) return null;
    const out: AsyncOperationStatus = { operationId: id, kind: j.kind, status: j.status, createdAt: j.createdAt, ...(j.finishedAt ? { finishedAt: j.finishedAt } : {}) };
    if (j.status === 'succeeded' && j.content) {
      out.result = { downloadUrl: operationDownloadPath('super-admin', id), expiresAt: j.expiresAt ?? new Date(Date.parse(j.finishedAt ?? j.createdAt) + 24 * 3_600_000).toISOString(),
        filename: j.filename ?? `${j.kind}.csv`, contentType: j.contentType ?? 'text/csv', bytes: j.content.length, ...(j.rows !== undefined ? { rows: Number(j.rows) } : {}) };
    }
    if (j.status === 'failed') out.error = { code: 'EXPORT_FAILED', message: String(j.error ?? 'The export failed.').slice(0, 300) };
    return out;
  }

  async download(ctx: any, id: string): Promise<{ status: AsyncOperationStatus['status']; file?: { bytes: Buffer; filename: string; contentType: string } } | null> {
    const j = await this.load(id);
    if (!j || !this.readable(ctx, j)) return null;
    if (j.status !== 'succeeded' || !j.content) return { status: j.status };
    return { status: j.status, file: { bytes: j.content, filename: j.filename ?? `${j.kind}.csv`, contentType: j.contentType ?? 'text/csv' } };
  }
}
