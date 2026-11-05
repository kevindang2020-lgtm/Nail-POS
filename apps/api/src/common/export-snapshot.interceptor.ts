// export-snapshot.interceptor.ts — BUILD_PLAN Phase 9 (Constitution 2 §153 "exports"; Constitution 12 §323): every data
// export leaves a record of WHO took WHAT — the person (or worker), the permission it was authorized under, the filters,
// how many rows and a sha256 checksum of exactly what was handed over (export_snapshots, migration 532, append-only).
//
// One choke point instead of a call in every exporter: the interceptor recognises an export route by its declared key
// (an `*.export` / `pos.<domain>.export` permission) or its path (an `export` segment / a `.csv` file), lets the handler
// run, summarises the body it returns (CSV text, `{ csv }`, `{ rows | items }`, an array) and writes the snapshot BEFORE the
// body leaves. Fail closed: an export whose record cannot be written is not handed over (503). A response that hands
// nothing over (a `disabledReason`, an empty body) records nothing.
import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, mergeMap, type Observable } from 'rxjs';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { stripClientTenantKeys } from '@aipowersalon/permissions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this route an export? Its key's action names an export, or its path has an export segment / a CSV file. */
export function isExportRoute(key: string | null | undefined, path: string, method: string): boolean {
  if (!/^(GET|POST)$/i.test(method || '')) return false;
  // an async export's job polling / processing hands nothing over — only its download does
  if (/\/exports?\/jobs(\/|$)/i.test(path) && !/\/download\/?$/i.test(path)) return false;
  const action = String(key ?? '').split('.').pop() ?? '';
  if (/(^|_)export$/.test(action)) return true;
  return /(^|\/)exports?(\/|$|\.)/i.test(path) || /\.csv(\?|$)/i.test(path);
}

export interface ExportSummary { rowCount: number; format: string; content: string }
/** What was handed over: rows, format and the exact content (for the checksum). null = nothing was handed over. */
export function summarizeExport(body: unknown): ExportSummary | null {
  if (body === null || body === undefined) return null;
  const csvRows = (csv: string) => { const lines = csv.split(/\r?\n/).filter((l) => l.length > 0); return Math.max(0, lines.length - 1); };   // minus the header
  if (typeof body === 'string') return body.length ? { rowCount: csvRows(body), format: 'csv', content: body } : null;
  if (Buffer.isBuffer(body)) return body.length ? { rowCount: 0, format: 'binary', content: body.toString('base64') } : null;
  if (Array.isArray(body)) return { rowCount: body.length, format: 'json', content: JSON.stringify(body) };
  if (typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.disabledReason && !b.csv && !b.rows && !b.items) return null;
    if (typeof b.csv === 'string') return b.csv.length ? { rowCount: csvRows(b.csv), format: String(b.format ?? 'csv'), content: b.csv } : null;
    for (const k of ['rows', 'items', 'data', 'records']) if (Array.isArray(b[k])) return { rowCount: (b[k] as unknown[]).length, format: String(b.format ?? 'json'), content: JSON.stringify(body) };
    return { rowCount: 0, format: String(b.format ?? 'json'), content: JSON.stringify(body) };
  }
  return null;
}

export const exportChecksum = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');

/** The filters as the caller sent them — never the tenant / branch keys (the server derives those), capped in size. */
export function exportFilters(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object') return {};
  const clean = stripClientTenantKeys({ ...(query as Record<string, unknown>) });
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean).slice(0, 40)) out[k.slice(0, 64)] = typeof v === 'string' ? v.slice(0, 200) : v;
  return out;
}

export interface ExportSnapshotRow {
  tenantId: string | null; branchId: string | null; userId: string | null; actor: string | null; permission: string; exportKind: string;
  route: string; filters: Record<string, unknown>; format: string; rowCount: number; byteCount: number; checksum: string;
}
export function snapshotFor(req: any, key: string | null, summary: ExportSummary): ExportSnapshotRow {
  const ctx = req?.ctx ?? {};
  const route = String(req?.route?.path ?? req?.path ?? '').slice(0, 300);
  const uid = String(ctx.userId ?? '');
  return {
    tenantId: UUID.test(String(ctx.tenantId ?? '')) ? String(ctx.tenantId) : null,
    branchId: UUID.test(String(ctx.branchId ?? '')) ? String(ctx.branchId) : null,
    userId: UUID.test(uid) ? uid : null, actor: UUID.test(uid) ? null : (uid || null),
    permission: key || `route:${route}`,
    exportKind: route.replace(/^\/+/, '').replace(/\/:([^/]+)/g, '/{$1}') || 'export',
    route: `${String(req?.method ?? 'GET').toUpperCase()} ${route}`, filters: exportFilters(req?.query),
    format: summary.format, rowCount: summary.rowCount, byteCount: Buffer.byteLength(summary.content, 'utf8'), checksum: exportChecksum(summary.content),
  };
}

export async function writeExportSnapshot(db: any, s: ExportSnapshotRow): Promise<void> {
  await sql`insert into export_snapshots (tenant_id, branch_id, user_id, actor, permission, export_kind, route, filters, format, row_count, byte_count, checksum)
    values (${s.tenantId}, ${s.branchId}, ${s.userId}, ${s.actor}, ${s.permission}, ${s.exportKind}, ${s.route}, ${JSON.stringify(s.filters)}::jsonb, ${s.format}, ${s.rowCount}, ${s.byteCount}, ${s.checksum})`.execute(db);
}

@Injectable()
export class ExportSnapshotInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, @Optional() @Inject(DATABASE) private readonly db?: AppDatabase | null) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const key = this.reflector.get<string>('perm', context.getHandler()) ?? null;
    if (!isExportRoute(key, String(req?.route?.path ?? req?.path ?? ''), String(req?.method ?? ''))) return next.handle();
    return next.handle().pipe(mergeMap((body) => from((async () => {
      const summary = summarizeExport(body);
      if (!summary || !this.db) return body;   // nothing handed over (or no database: the in-memory test app)
      try { await writeExportSnapshot(this.db, snapshotFor(req, key, summary)); }
      catch { throw new ServiceUnavailableException({ code: 'SERVICE_UNAVAILABLE', message: 'The export could not be recorded, so it was not handed over. Try again.' }); }
      return body;
    })())));
  }
}
