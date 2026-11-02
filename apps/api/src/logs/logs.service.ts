// logs.service.ts — write (system-internal, used by producer modules via LogSink) + query (permission-gated read).
// write() never throws to its caller: a logging failure must not break the action being logged. Metadata is shallow-
// sanitized to drop obviously-sensitive keys so secrets never land in the log store.
import { hasPermission } from '@aipowersalon/permissions';
import { normalizeFilters, isSeverity, type LogSeverity } from './logs-core';
import type { LogsContext, LogWriteCtx, LogEntryInput, LogEntryView, LogSink } from './logs.dto';
import type { LogsRepositoryPort, StoredLog } from './logs.repository';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }

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

  async query(ctx: LogsContext, raw: { category?: string; severity?: string; source?: string; search?: string; limit?: unknown }): Promise<{ logs: LogEntryView[] }> {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, 'pos.logs.view')) throw new ForbiddenError('Missing pos.logs.view');
    const rows = await this.repo.query(ctx, normalizeFilters(raw));
    return { logs: rows.map((r) => this.view(r)) };
  }
}
