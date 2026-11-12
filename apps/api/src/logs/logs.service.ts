// logs.service.ts — write (system-internal, used by producer modules via LogSink) + query (permission-gated read).
// write() never throws to its caller: a logging failure must not break the action being logged. Metadata is shallow-
// sanitized to drop obviously-sensitive keys so secrets never land in the log store.
import { hasPermission } from '@aipowersalon/permissions';
import { normalizeFilters, isSeverity, type LogSeverity } from './logs-core';
import type { LogsContext, LogWriteCtx, LogEntryInput, LogEntryView, LogSink } from './logs.dto';
import type { LogsRepositoryPort, StoredLog, LogSummary } from './logs.repository';
import { matchesFilters } from './logs-core';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(readonly code: string) { super(code); this.name = 'ValidationError'; } }

const SENSITIVE = /secret|password|token|signing|api[_-]?key|authorization|cookie/i;
function sanitize(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) { if (SENSITIVE.test(k)) out[k] = '[redacted]'; else if (typeof v === 'object' && v !== null) out[k] = '[object]'; else out[k] = v; }
  return out;
}

export class LogsService implements LogSink {
  constructor(private readonly repo: LogsRepositoryPort, private readonly now: () => number = () => Date.now()) {}

  private view(r: StoredLog): LogEntryView {
    return { id: r.id, category: r.category, severity: r.severity, source: r.source, message: r.message, correlationId: r.correlationId, relatedId: r.relatedId, status: r.status, metadata: r.metadata, createdIso: r.createdMs ? new Date(r.createdMs).toISOString() : null };
  }

  async write(ctx: LogWriteCtx, entry: LogEntryInput): Promise<void> {
    try {
      const severity: LogSeverity = isSeverity(entry.severity) ? entry.severity : 'info';
      await this.repo.insert(ctx, { ...entry, severity, source: (entry.source || 'system').slice(0, 64), message: (entry.message || '').slice(0, 1000), metadata: sanitize(entry.metadata) });
    } catch { /* logging must never break the caller */ }
  }

  async query(ctx: LogsContext, raw: { category?: string; severity?: string; source?: string; search?: string; relatedId?: string; limit?: unknown; from?: string; to?: string; page?: unknown; pageSize?: unknown }): Promise<{ logs: LogEntryView[]; total?: number; page?: number; pageSize?: number; totalPages?: number; summary?: LogSummary }> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, 'pos.logs.view')) throw new ForbiddenError('Missing pos.logs.view');
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
    return { logs: rows.map((r) => this.view(r)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), summary };
  }
}
