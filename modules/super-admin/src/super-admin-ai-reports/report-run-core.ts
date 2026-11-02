// Pure logic for the report-run generation foundation. No DB/Nest deps. This is where the idempotency key is derived,
// generation-status transitions are validated, and the STRUCTURED metrics snapshot is checked for grounding — so a run's
// numbers can only ever come from validated calculations, never invented. Fully testable without a database.

export const GEN_STATUSES = ['requested', 'collecting', 'completed', 'partial', 'failed', 'cancelled'] as const;
export type GenStatus = (typeof GEN_STATUSES)[number];

// A stable idempotency key for a generation request: same report + scope + period + source ⇒ same key ⇒ same run.
export function buildRunIdempotencyKey(input: { reportKey: string; scopeType: string; tenantId?: string | null; branchId?: string | null; start: string; end: string; source: string }): string {
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
  return [norm(input.reportKey), norm(input.scopeType), norm(input.tenantId) || 'none', norm(input.branchId) || 'none', norm(input.start), norm(input.end), norm(input.source) || 'on_demand'].join('|');
}

const GEN_TRANSITIONS: Record<string, GenStatus[]> = {
  requested: ['collecting', 'failed', 'cancelled'],
  collecting: ['completed', 'partial', 'failed', 'cancelled'],
  completed: [], partial: [], failed: [], cancelled: [],
};
export function canGenTransition(from: string, to: string): boolean {
  return (GEN_TRANSITIONS[String(from || '').toLowerCase()] || []).includes(String(to || '').toLowerCase() as GenStatus);
}

export interface MetricsSnapshot { [k: string]: number | string | boolean | null }
export type SnapshotResult = { ok: true; status: 'completed' | 'partial'; metrics: MetricsSnapshot } | { ok: false; reason: string };

// Validates a metrics snapshot before it is stored on a run. Enforces grounding: a valid date range, and every numeric
// metric must be a finite number (no NaN/Infinity slipping in). If the source had no data, the run is honestly `partial`
// with a "Data unavailable" marker rather than fabricated zeros presented as real activity.
export function validateMetricsSnapshot(input: { start: string; end: string; hasData: boolean; metrics: MetricsSnapshot }): SnapshotResult {
  const startMs = Date.parse(input.start), endMs = Date.parse(input.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { ok: false, reason: 'invalid date range' };
  if (endMs < startMs) return { ok: false, reason: 'end date before start date' };
  for (const [k, v] of Object.entries(input.metrics || {})) {
    if (typeof v === 'number' && !Number.isFinite(v)) return { ok: false, reason: `metric "${k}" is not a finite number` };
  }
  if (!input.hasData) return { ok: true, status: 'partial', metrics: { ...input.metrics, dataAvailable: false, note: 'Data unavailable for this period' } };
  return { ok: true, status: 'completed', metrics: { ...input.metrics, dataAvailable: true } };
}

export function generateReportReference(reportKey: string, nowMs: number): string {
  const d = new Date(nowMs);
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `RPT-${String(reportKey || 'report').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}-${stamp}-${Math.floor(nowMs % 100000)}`;
}
