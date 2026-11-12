// logs-core.ts — PURE helpers for the event-log store. Severity validation/ranking, filter normalization, in-memory
// matching, and limit clamping. No IO.
export type LogCategory = 'device' | 'integration';
export type LogSeverity = 'info' | 'warning' | 'error' | 'critical';

const SEVERITIES: LogSeverity[] = ['info', 'warning', 'error', 'critical'];
export const isSeverity = (s: string): s is LogSeverity => (SEVERITIES as string[]).includes(s);
export const isCategory = (c: string): c is LogCategory => c === 'device' || c === 'integration';
export function severityRank(s: LogSeverity): number { return SEVERITIES.indexOf(s); }

export interface LogFilters { category?: LogCategory; severity?: LogSeverity; source?: string; search?: string; relatedId?: string; limit: number }

export function normalizeFilters(q: { category?: string; severity?: string; source?: string; search?: string; relatedId?: string; limit?: unknown }): LogFilters {
  const limitRaw = Number(q.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100;
  return {
    category: q.category && isCategory(q.category) ? q.category : undefined,
    severity: q.severity && isSeverity(q.severity) ? q.severity : undefined,
    source: q.source ? String(q.source).trim().toLowerCase() : undefined,
    search: q.search ? String(q.search).trim().toLowerCase() : undefined,
    // Device Integration Logs backlog · 03: one device's own history (the record id its events point at), exact match only
    relatedId: q.relatedId && /^[A-Za-z0-9_:-]{1,80}$/.test(String(q.relatedId).trim()) ? String(q.relatedId).trim() : undefined,
    limit,
  };
}

export interface LogRowLike { category: string; severity: string; source: string; message: string; createdMs: number; relatedId?: string | null }
export function matchesFilters(r: LogRowLike, f: LogFilters): boolean {
  if (f.category && r.category !== f.category) return false;
  if (f.severity && r.severity !== f.severity) return false;
  if (f.source && r.source.toLowerCase() !== f.source) return false;
  if (f.search && !(`${r.message} ${r.source}`.toLowerCase().includes(f.search))) return false;
  if (f.relatedId && r.relatedId !== f.relatedId) return false;
  return true;
}
