// Pure logic for data-retention rules. No DB/Nest deps. Controlled data-class/action vocab, per-class MINIMUM retention
// floors (compliance-relevant logs cannot be set too short), cutoff computation, versioning, and dry-run purge summary.
// Legal-hold records are always excluded from purge. This layer never deletes anything — physical purge is data-plane.

export const DATA_CLASSES = ['audit_events', 'login_attempts', 'report_exports', 'notifications', 'customer_privacy_requests', 'session_history', 'device_heartbeats'] as const;
export const RETENTION_ACTIONS = ['delete', 'anonymize', 'archive'] as const;

// Minimum retention floors (days). Compliance/security logs must be kept at least this long.
export const MIN_RETENTION_DAYS: Record<string, number> = {
  audit_events: 365, login_attempts: 90, report_exports: 180, customer_privacy_requests: 365,
  notifications: 30, session_history: 30, device_heartbeats: 7,
};

export function normalizeDataClass(c: string): string { const v = String(c || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return (DATA_CLASSES as readonly string[]).includes(v) ? v : ''; }
export function normalizeAction(a: string): string { const v = String(a || '').trim().toLowerCase(); return (RETENTION_ACTIONS as readonly string[]).includes(v) ? v : 'delete'; }

export type ValidateResult = { ok: true } | { ok: false; reason: string };
export function validateRetentionRule(input: { dataClass: string; retentionDays: number; action: string }): ValidateResult {
  const dc = normalizeDataClass(input.dataClass);
  if (!dc) return { ok: false, reason: `unsupported data class "${input.dataClass}"` };
  if (!(RETENTION_ACTIONS as readonly string[]).includes(String(input.action || '').toLowerCase())) return { ok: false, reason: `unsupported action "${input.action}"` };
  const days = input.retentionDays;
  if (!Number.isInteger(days) || days < 0) return { ok: false, reason: 'retentionDays must be a non-negative integer' };
  const floor = MIN_RETENTION_DAYS[dc] ?? 0;
  if (days < floor) return { ok: false, reason: `retentionDays for ${dc} must be ≥ ${floor} (compliance minimum)` };
  return { ok: true };
}

// Records with a timestamp at or before the cutoff are eligible for the retention action.
export function computeCutoff(nowMs: number, retentionDays: number): string { return new Date(nowMs - retentionDays * 86400000).toISOString(); }

export function nextRetentionVersion(existing: number[]): number { return (existing && existing.length ? Math.max(...existing) : 0) + 1; }
export function retentionStatusLabel(status: string): string { const s = String(status || '').toLowerCase(); return s === 'active' ? 'Active' : s === 'paused' ? 'Paused' : 'Archived'; }

export function assemblePurgePreview(input: { dataClass: string; cutoff: string; eligibleCount: number; legalHoldExcluded: number; action: string }) {
  const net = Math.max(0, input.eligibleCount - input.legalHoldExcluded);
  return { dataClass: input.dataClass, action: input.action, cutoff: input.cutoff, eligibleCount: input.eligibleCount, legalHoldExcluded: input.legalHoldExcluded, netToProcess: net, message: `${net} ${input.dataClass} record(s) older than ${input.cutoff.slice(0, 10)} eligible for ${input.action}${input.legalHoldExcluded ? ` (${input.legalHoldExcluded} under legal hold excluded)` : ''}. Dry run — nothing deleted.` };
}
