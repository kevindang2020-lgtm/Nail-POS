// logs-core.ts — PURE helpers for the event-log store. Severity validation/ranking, filter normalization, in-memory
// matching, and limit clamping. No IO.
export type LogCategory = 'device' | 'integration';
export type LogSeverity = 'info' | 'warning' | 'error' | 'critical';

const SEVERITIES: LogSeverity[] = ['info', 'warning', 'error', 'critical'];
export const isSeverity = (s: string): s is LogSeverity => (SEVERITIES as string[]).includes(s);
export const isCategory = (c: string): c is LogCategory => c === 'device' || c === 'integration';
export function severityRank(s: LogSeverity): number { return SEVERITIES.indexOf(s); }

export interface LogFilters { category?: LogCategory; severity?: LogSeverity; source?: string; search?: string; relatedId?: string; correlationId?: string; limit: number }

export function normalizeFilters(q: { category?: string; severity?: string; source?: string; search?: string; relatedId?: string; correlationId?: string; limit?: unknown }): LogFilters {
  const limitRaw = Number(q.limit);
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100;
  return {
    category: q.category && isCategory(q.category) ? q.category : undefined,
    severity: q.severity && isSeverity(q.severity) ? q.severity : undefined,
    source: q.source ? String(q.source).trim().toLowerCase() : undefined,
    search: q.search ? String(q.search).trim().toLowerCase() : undefined,
    // Device Integration Logs backlog · 03: one device's own history (the record id its events point at), exact match only
    relatedId: q.relatedId && /^[A-Za-z0-9_:-]{1,80}$/.test(String(q.relatedId).trim()) ? String(q.relatedId).trim() : undefined,
    // Device Integration Logs backlog · 02: one trace — every event recorded under the same correlation id, exact match only
    correlationId: q.correlationId && /^[A-Za-z0-9_.:-]{1,120}$/.test(String(q.correlationId).trim()) ? String(q.correlationId).trim() : undefined,
    limit,
  };
}

export interface LogRowLike { category: string; severity: string; source: string; message: string; createdMs: number; relatedId?: string | null; correlationId?: string | null }
export function matchesFilters(r: LogRowLike, f: LogFilters): boolean {
  if (f.category && r.category !== f.category) return false;
  if (f.severity && r.severity !== f.severity) return false;
  if (f.source && r.source.toLowerCase() !== f.source) return false;
  if (f.search && !(`${r.message} ${r.source}`.toLowerCase().includes(f.search))) return false;
  if (f.relatedId && r.relatedId !== f.relatedId) return false;
  if (f.correlationId && r.correlationId !== f.correlationId) return false;
  return true;
}

// ── Device Integration Logs backlog · 08: the sanitized export ─────────────────────────────────────────────────────────
// What leaves the salon in a log file: the event's time, category, severity, source, message, status and its record /
// trace ids — never the metadata column (provider payloads), and the message itself is redacted: e-mail addresses,
// long digit runs (card / phone / account-like numbers, separators allowed — only the last 4 digits stay) and any
// `secret=…` / `token: …` style value. Cells are formula-safe (a leading = + - @ is quoted).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEYVAL_RE = /\b(secret|password|passcode|pin|token|signing|api[_-]?key|authorization|cookie|cvv|cvc)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const DIGITS_RE = /(?<![\w-])\+?(?:\d[\s().-]{0,2}){8,}\d(?![\w-])/g;   // 9+ digits, not inside a word / id (UUIDs and dates stay)
export function redactLogText(raw: unknown): string {
  let s = String(raw ?? '');
  s = s.replace(KEYVAL_RE, (_m, k: string, sep: string) => `${k}${sep}[redacted]`);
  s = s.replace(EMAIL_RE, '[email]');
  s = s.replace(DIGITS_RE, (m) => { if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2})?$/.test(m)) return m;   // a date (and its hour), not a number
    const d = m.replace(/\D/g, ''); return `•••${d.slice(-4)}`; });
  return s;
}
export function logCsvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** the longest range one export may cover (a fixed, bounded window — never "everything") */
export const LOG_EXPORT_MAX_DAYS = 31;
/** the most rows one file holds; a range with more says so in the file (Truncated: yes) instead of silently cutting */
export const LOG_EXPORT_MAX_ROWS = 5000;
export function logExportRangeDays(from: string, to: string): number { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1; }
