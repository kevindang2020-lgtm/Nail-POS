// logs.service.ts — write (system-internal, used by producer modules via LogSink) + query (permission-gated read).
// write() never throws to its caller: a logging failure must not break the action being logged. Metadata is shallow-
// sanitized to drop obviously-sensitive keys so secrets never land in the log store.
import { hasPermission } from '@aipowersalon/permissions';
import { normalizeFilters, isSeverity, type LogSeverity, redactLogText, logCsvCell, LOG_EXPORT_MAX_DAYS, LOG_EXPORT_MAX_ROWS, logExportRangeDays } from './logs-core';
import type { LogsContext, LogWriteCtx, LogEntryInput, LogEntryView, LogSink } from './logs.dto';
import type { LogsRepositoryPort, StoredLog, LogSummary, LogPaymentEnvironment } from './logs.repository';
import { matchesFilters } from './logs-core';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(readonly code: string) { super(code); this.name = 'ValidationError'; } }
/** the export cannot leave its audit row (no store / the write failed) → no file */
export class ExportUnavailableError extends Error { constructor(msg = 'Log export is unavailable') { super(msg); this.name = 'ExportUnavailableError'; } }

const SENSITIVE = /secret|password|token|signing|api[_-]?key|authorization|cookie/i;
function sanitize(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) { if (SENSITIVE.test(k)) out[k] = '[redacted]'; else if (typeof v === 'object' && v !== null) out[k] = '[object]'; else out[k] = v; }
  return out;
}

export class LogsService implements LogSink {
  constructor(private readonly repo: LogsRepositoryPort, private readonly now: () => number = () => Date.now()) {}
  private can(ctx: LogsContext, key: string): boolean { return hasPermission(ctx as any, key); }

  private view(r: StoredLog): LogEntryView {
    return { id: r.id, category: r.category, severity: r.severity, source: r.source, message: r.message, correlationId: r.correlationId, relatedId: r.relatedId, status: r.status, metadata: r.metadata, createdIso: r.createdMs ? new Date(r.createdMs).toISOString() : null };
  }

  async write(ctx: LogWriteCtx, entry: LogEntryInput): Promise<void> {
    try {
      const severity: LogSeverity = isSeverity(entry.severity) ? entry.severity : 'info';
      await this.repo.insert(ctx, { ...entry, severity, source: (entry.source || 'system').slice(0, 64), message: (entry.message || '').slice(0, 1000), metadata: sanitize(entry.metadata) });
    } catch { /* logging must never break the caller */ }
  }

  async query(ctx: LogsContext, raw: { category?: string; severity?: string; source?: string; search?: string; relatedId?: string; correlationId?: string; limit?: unknown; from?: string; to?: string; page?: unknown; pageSize?: unknown }): Promise<{ logs: LogEntryView[]; total?: number; page?: number; pageSize?: number; totalPages?: number; summary?: LogSummary; paymentEnvironment?: LogPaymentEnvironment }> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!this.can(ctx, 'pos.logs.view')) throw new ForbiddenError('Missing pos.logs.view');
    const f = normalizeFilters(raw);
    if (raw.page === undefined) { const rows = await this.repo.query(ctx, f); return { logs: rows.map((r) => this.view(r)) }; }   // the legacy shape, unchanged
    // SUNMI batch 8 (Nov 9 2026): dated, numbered pages (newest first) + the range's counts
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const from = raw.from && ymd.test(String(raw.from)) ? String(raw.from) : undefined; const to = raw.to && ymd.test(String(raw.to)) ? String(raw.to) : undefined;
    if ((raw.from && !from) || (raw.to && !to) || (from && to && from > to)) throw new ValidationError('LOGS_INVALID_PERIOD');
    const pageSize = [10, 25, 50, 100].includes(Number(raw.pageSize)) ? Number(raw.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.trunc(Number(raw.page)) || 1));
    let rows: StoredLog[]; let total: number; let summary: LogSummary;
    if (this.repo.page) ({ rows, total, summary } = await this.repo.page(ctx, { ...f, from, to, page, pageSize }));
    else {
      const lo = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity; const hi = to ? Date.parse(`${to}T23:59:59.999Z`) : Infinity;
      const all = (await this.repo.query(ctx, { ...f, limit: 500 })).filter((r) => matchesFilters(r, f) && r.createdMs >= lo && r.createdMs <= hi);
      total = all.length; rows = all.slice((page - 1) * pageSize, page * pageSize);
      summary = { events: total, warnings: all.filter((r) => r.severity === 'warning').length, errors: all.filter((r) => r.severity === 'error' || r.severity === 'critical').length,
        device: all.filter((r) => r.category === 'device').length, integration: all.filter((r) => r.category === 'integration').length };
    }
    const paymentEnvironment = this.repo.paymentEnvironment ? await this.repo.paymentEnvironment(ctx) : undefined;
    return { logs: rows.map((r) => this.view(r)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), summary, ...(paymentEnvironment ? { paymentEnvironment } : {}) };
  }

  /** Device Integration Logs backlog · 08 (Nov 12 2026): the sanitized CSV of one fixed date range (from AND to, at most
   *  31 days, the same days as the page), the page's filters, newest first, at most 5,000 rows (the file says when the
   *  range held more). Needs pos.logs.view AND pos.reports.export. The metadata column never leaves; messages are
   *  redacted (redactLogText). Fail-closed audit: the export is recorded (who, range, filters, row count — never the
   *  rows) BEFORE the file is returned; no audit row → no file. Read-only otherwise. */
  async exportCsv(ctx: LogsContext, query: object): Promise<string> {
    const q = query as Record<string, unknown>; const g = (k: string): string | undefined => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
    const raw = { category: g('category'), severity: g('severity'), source: g('source'), search: g('search'), relatedId: g('relatedId'), correlationId: g('correlationId'), from: g('from'), to: g('to') };
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!this.can(ctx, 'pos.logs.view')) throw new ForbiddenError('Missing pos.logs.view');
    if (!this.can(ctx, 'pos.reports.export')) throw new ForbiddenError('Missing pos.reports.export');
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const from = raw.from && ymd.test(String(raw.from)) ? String(raw.from) : undefined; const to = raw.to && ymd.test(String(raw.to)) ? String(raw.to) : undefined;
    if (!from || !to || from > to || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) throw new ValidationError('LOGS_INVALID_PERIOD');
    if (logExportRangeDays(from, to) > LOG_EXPORT_MAX_DAYS) throw new ValidationError('LOGS_EXPORT_RANGE_TOO_LONG');
    if (!this.repo.recordExport) throw new ExportUnavailableError();
    const f = normalizeFilters({ ...raw, limit: 500 });
    let rows: StoredLog[]; let total: number;
    if (this.repo.page) ({ rows, total } = await this.repo.page(ctx, { ...f, from, to, page: 1, pageSize: LOG_EXPORT_MAX_ROWS }));
    else {
      const lo = Date.parse(`${from}T00:00:00Z`), hi = Date.parse(`${to}T23:59:59.999Z`);
      const all = (await this.repo.query(ctx, f)).filter((r) => matchesFilters(r, f) && r.createdMs >= lo && r.createdMs <= hi);
      total = all.length; rows = all.slice(0, LOG_EXPORT_MAX_ROWS);
    }
    const filters = { category: f.category ?? 'all', severity: f.severity ?? 'all', source: f.source ?? 'all', search: f.search ? 'yes' : 'no', device: f.relatedId ? 'yes' : 'no', trace: f.correlationId ? 'yes' : 'no' };
    try { await this.repo.recordExport(ctx, { from, to, rows: rows.length, total, filters }); }
    catch (e) { throw new ExportUnavailableError(`Log export audit failed: ${(e as Error).message}`); }
    const line = (cells: unknown[]) => cells.map(logCsvCell).join(',');
    const out = [line(['Device and integration logs (sanitized)']), line(['Generated', new Date(this.now()).toISOString()]), line(['Period', `${from} to ${to} (UTC days, as on the page)`]),
      line(['Category', filters.category]), line(['Severity', filters.severity]), line(['Source', filters.source]), line(['Search', filters.search]),
      line(['Redaction', 'metadata omitted; e-mail addresses, long numbers (last 4 digits kept) and secret / token values removed from messages']),
      line(['Rows', String(rows.length)]), line(['Matching events', String(total)]), line(['Truncated', total > rows.length ? `yes (first ${rows.length} newest)` : 'no']), '',
      line(['Time', 'Category', 'Severity', 'Source', 'Message', 'Status', 'Related record', 'Trace id']),
      ...rows.map((r) => line([r.createdMs ? new Date(r.createdMs).toISOString() : '', r.category, r.severity, redactLogText(r.source), redactLogText(r.message), r.status ? redactLogText(r.status) : '', r.relatedId ?? '', r.correlationId ?? '']))];
    return '\uFEFF' + out.join('\r\n') + '\r\n';
  }
}
