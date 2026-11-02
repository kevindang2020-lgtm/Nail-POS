// async-export.core.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the pure half of the ONE async operation contract
// (no Nest, no database): which realm an export belongs to, what of the request is kept (query + path parameters, never a
// body, never a client-supplied tenant), how a handler's synchronous answer becomes ONE stored file, and how an
// api_operations row reads on the wire (AsyncOperationStatus).
import {
  operationStatusPath, operationDownloadPath, type AsyncOperationAccepted, type AsyncOperationBodyShape, type AsyncOperationStatus,
  type OperationRealm,
} from '@aipowersalon/api-contracts';
import { stripClientTenantKeys } from '@aipowersalon/permissions';

export { wantsAsync } from '@aipowersalon/api-contracts';

/** Results live this long; then the sweep deletes the file and the status reads `expired`. */
export const OPERATION_TTL_MS = 24 * 60 * 60_000;
/** The first poll the server suggests. */
export const POLL_AFTER_MS = 1_000;
export const EXPORT_JOB_TYPE = 'api.export';
export const EXPIRE_JOB_TYPE = 'api.operations.expire';
export const EXPORT_MAX_ATTEMPTS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** The realm whose /…/operations routes show this export. The route's own plane first; the shared /me routes by role. */
export function realmFor(routePath: string, role: string | null | undefined): OperationRealm {
  const seg = String(routePath || '').replace(/^\/+/, '').split('/')[0];
  if (seg === 'super-admin') return 'super-admin';
  if (seg === 'customer') return 'customer';
  if (seg === 'owner') return 'owner';
  if (seg === 'tech') return 'tech';
  if (seg === 'pos' || seg === 'tenant') return 'pos';
  const r = String(role ?? '').toUpperCase();
  if (r === 'SUPER_ADMIN') return 'super-admin';
  if (r === 'CUSTOMER') return 'customer';
  if (r === 'TECHNICIAN') return 'tech';
  if (r === 'OWNER') return 'owner';
  return 'pos';
}

/** The realm a principal's /…/operations routes may be read in (a customer never reads a staff realm and vice versa). */
export function realmAllowsRole(realm: OperationRealm, role: string | null | undefined): boolean {
  const r = String(role ?? '').toUpperCase();
  if (realm === 'super-admin') return r === 'SUPER_ADMIN';
  if (realm === 'customer') return r === 'CUSTOMER';
  return r !== 'SUPER_ADMIN' && r !== 'CUSTOMER' && r !== '';
}

const MAX_PARAMS = 40;
/** What of the request is kept to re-run it: query + path parameters (strings, capped), never a body, never the tenant /
 *  branch keys a client might send (the server derives those), never the async switch itself. */
export function requestParams(query: unknown, path: unknown): { query: Record<string, string | string[]>; path: Record<string, string> } {
  const clean = (o: unknown, allowArrays: boolean) => {
    const out: Record<string, any> = {};
    if (!o || typeof o !== 'object') return out;
    const src = stripClientTenantKeys({ ...(o as Record<string, unknown>) });
    for (const [k, v] of Object.entries(src).slice(0, MAX_PARAMS)) {
      if (k === 'async' || k.length > 64) continue;
      if (Array.isArray(v) && allowArrays) out[k] = v.slice(0, 20).map((x) => String(x).slice(0, 500));
      else if (v !== undefined && v !== null && typeof v !== 'object') out[k] = String(v).slice(0, 500);
    }
    return out;
  };
  return { query: clean(query, true), path: clean(path, false) };
}

/** The filled-in route for a template and its path parameters ("/owner/reports/:reportId/export" + {reportId} → …). */
export function fillRoute(template: string, path: Record<string, string>): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_m, k) => encodeURIComponent(path[k] ?? ''));
}

export interface ExportFile {
  bytes: Buffer;
  contentType: string;
  filename: string;
  rows?: number;
  /** How the synchronous JSON wrapped this file (absent when the answer WAS the file). */
  shape?: AsyncOperationBodyShape;
}

function headerValue(headers: Record<string, unknown>, name: string): string {
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
  const v = k ? headers[k] : undefined;
  return Array.isArray(v) ? String(v[0] ?? '') : v === undefined || v === null ? '' : String(v);
}
export function filenameFromDisposition(cd: string): string | null {
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ } }
  const m = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return m ? m[1].trim() : null;
}
const csvRows = (csv: string) => Math.max(0, csv.split(/\r?\n/).filter((l) => l.length > 0).length - 1);
const extFor = (ct: string) => /csv/i.test(ct) ? 'csv' : /json/i.test(ct) ? 'json' : /pdf/i.test(ct) ? 'pdf' : /spreadsheetml|excel/i.test(ct) ? 'xlsx' : /text\//i.test(ct) ? 'txt' : 'bin';
const CONTENT_FIELDS: Array<{ field: string; encodingFrom: (b: Record<string, unknown>) => 'utf8' | 'base64' }> = [
  { field: 'csv', encodingFrom: () => 'utf8' },
  { field: 'content', encodingFrom: (b) => (String(b.encoding ?? '').toLowerCase() === 'base64' ? 'base64' : 'utf8') },
  { field: 'base64', encodingFrom: () => 'base64' },
];

/**
 * A handler's synchronous answer → the ONE file the operation stores. The rules follow the answers the export routes give
 * today: CSV text (+ Content-Type / Content-Disposition headers), a Buffer (xlsx / pdf), a JSON envelope carrying the file
 * in `csv` / `content` (utf8 or base64) / `base64` beside its `filename` / `mime` / `contentType` / `rowCount`, or a plain
 * JSON document (a privacy export, a report). `null` = nothing was handed over (a disabled export answers that way).
 */
export function exportFileFrom(body: unknown, headers: Record<string, unknown>, fallbackName: string): ExportFile | null {
  const ct = headerValue(headers, 'content-type');
  const named = filenameFromDisposition(headerValue(headers, 'content-disposition'));
  if (body === null || body === undefined) return null;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    const bytes = Buffer.from(body as Uint8Array);
    if (!bytes.length) return null;
    const contentType = ct || 'application/octet-stream';
    return { bytes, contentType, filename: named || `${fallbackName}.${extFor(contentType)}` };
  }
  if (typeof body === 'string') {
    if (!body.length) return null;
    const contentType = ct || 'text/csv; charset=utf-8';
    return { bytes: Buffer.from(body, 'utf8'), contentType, filename: named || `${fallbackName}.${extFor(contentType)}`, rows: /csv/i.test(contentType) ? csvRows(body) : undefined };
  }
  if (typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.disabledReason && !b.csv && !b.content && !b.base64) return null;
    for (const c of CONTENT_FIELDS) {
      if (typeof b[c.field] !== 'string') continue;
      const encoding = c.encodingFrom(b);
      const raw = String(b[c.field]);
      const bytes = encoding === 'base64' ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
      const contentType = String(b.contentType ?? b.mimeType ?? b.mime ?? (c.field === 'csv' ? 'text/csv; charset=utf-8' : '')) || 'application/octet-stream';
      const filename = String(b.filename ?? '') || named || `${fallbackName}.${extFor(contentType)}`;
      const { [c.field]: _omit, ...fields } = b;
      const rowCount = Number(b.rowCount ?? b.rows ?? NaN);
      const rows = Number.isFinite(rowCount) ? rowCount : /csv/i.test(contentType) && encoding === 'utf8' ? csvRows(raw) : undefined;
      return { bytes, contentType, filename, rows, shape: { fields: fields as Record<string, unknown>, contentField: c.field, encoding } };
    }
    const json = JSON.stringify(body);
    const list = ['rows', 'items', 'data', 'records'].map((k) => b[k]).find(Array.isArray) as unknown[] | undefined;
    return { bytes: Buffer.from(json, 'utf8'), contentType: 'application/json', filename: String(b.filename ?? '') || named || `${fallbackName}.json`, rows: Array.isArray(body) ? body.length : list?.length };
  }
  return null;
}

/** The 202 body. statusUrl is a path on the API base the client already uses (its own client adds any prefix). */
export function acceptedBody(realm: OperationRealm, id: string): AsyncOperationAccepted {
  return { operationId: id, status: 'queued', statusUrl: operationStatusPath(realm, id), pollAfterMs: POLL_AFTER_MS };
}
/** The Location header: the status path on the SAME prefix the request came in on (/api/v1 or the legacy root). */
export function locationFor(originalUrl: string, statusUrl: string): string {
  return /^\/api\/v1(\/|$)/.test(String(originalUrl || '')) ? `/api/v1${statusUrl}` : statusUrl;
}

const iso = (v: unknown): string | undefined => (v ? new Date(v as any).toISOString() : undefined);
/** An api_operations row on the wire. An expired-but-not-yet-swept success reads `expired` (no download URL). */
export function toStatus(row: any, now: number = Date.now()): AsyncOperationStatus {
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  let status = String(row.status) as AsyncOperationStatus['status'];
  if (status === 'succeeded' && expiresAt && expiresAt.getTime() <= now) status = 'expired';
  const meta = (typeof row.result_meta === 'string' ? JSON.parse(row.result_meta) : row.result_meta) ?? null;
  const err = (typeof row.error === 'string' ? JSON.parse(row.error) : row.error) ?? null;
  const out: AsyncOperationStatus = { operationId: String(row.id), kind: String(row.kind), status, createdAt: iso(row.created_at)! };
  if (row.progress !== null && row.progress !== undefined) out.progress = Number(row.progress);
  if (row.started_at) out.startedAt = iso(row.started_at);
  if (row.finished_at) out.finishedAt = iso(row.finished_at);
  if (status === 'succeeded' && meta) {
    out.result = {
      downloadUrl: operationDownloadPath(row.realm as OperationRealm, String(row.id)), expiresAt: expiresAt!.toISOString(),
      filename: String(meta.filename), contentType: String(meta.contentType), bytes: Number(meta.bytes ?? 0),
      ...(meta.rows !== undefined && meta.rows !== null ? { rows: Number(meta.rows) } : {}),
      ...(meta.shape ? { body: meta.shape } : {}),
    };
  }
  if (status === 'failed' && err) out.error = { code: String(err.code ?? 'INTERNAL_ERROR'), message: String(err.message ?? 'The export failed.') };
  return out;
}

/** An error thrown while the export ran → the operation's { code, message } and whether retrying can help. */
export function operationErrorFrom(e: any): { code: string; message: string; retryable: boolean } {
  const status = Number(e?.getStatus?.() ?? e?.status ?? 500);
  const resp = e?.getResponse?.() ?? e?.response ?? null;
  const r = resp && typeof resp === 'object' ? resp as Record<string, any> : null;
  const code = String(r?.code ?? r?.error?.code ?? (status === 403 ? 'PERMISSION_DENIED' : status === 401 ? 'SESSION_ENDED' : status === 404 ? 'RESOURCE_NOT_FOUND' : status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'));
  const raw = r?.message ?? r?.error?.message ?? (typeof resp === 'string' ? resp : e?.message);
  const message = (Array.isArray(raw) ? raw.join('; ') : String(raw ?? 'The export failed.')).slice(0, 300);
  return { code, message: status >= 500 ? 'The export failed on our side.' : message, retryable: status >= 500 };
}
