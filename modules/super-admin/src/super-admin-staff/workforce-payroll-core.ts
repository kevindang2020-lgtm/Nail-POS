// Pure logic for payroll-sync monitoring + controlled retry (§35). No DB/Nest deps. This layer never touches payroll
// amounts — only sync status, safe error metadata, and retry eligibility/backoff.

export const PAYROLL_SYNC_STATUSES = ['synced', 'pending', 'processing', 'failed', 'retrying', 'not_configured', 'not_required'] as const;
export type PayrollSyncStatus = (typeof PAYROLL_SYNC_STATUSES)[number];

// A failed/retrying event is a candidate for retry; everything else is terminal or in-flight.
export const RETRYABLE_STATUSES: PayrollSyncStatus[] = ['failed', 'retrying'];
// Permanent failures must NOT be retried until the underlying configuration is fixed (§35).
export const PERMANENT_ERROR_CODES = ['MAPPING_MISSING', 'MAPPING_INVALID', 'AUTH_FAILED', 'CONFIG_INVALID', 'UNAUTHORIZED'];
export const PAYROLL_RETRY_AUDIT_TYPE = 'workforce_payroll_sync_retried';
export const MIN_PAYROLL_REASON_LEN = 8;

export interface PayrollEventFacts { status: string; errorCode: string | null; attemptCount: number; maxAttempts: number }
export type RetryEligibility = { ok: true } | { ok: false; reason: string };

// Eligibility gate: status retryable, attempts remaining, and not a permanent (config) error.
export function retryEligibility(e: PayrollEventFacts): RetryEligibility {
  const status = String(e.status || '').toLowerCase();
  if (!RETRYABLE_STATUSES.includes(status as PayrollSyncStatus)) return { ok: false, reason: `status "${status}" is not retryable` };
  if ((e.attemptCount ?? 0) >= (e.maxAttempts ?? 0)) return { ok: false, reason: 'retry limit reached — escalate instead' };
  const code = (e.errorCode || '').toUpperCase();
  if (code && PERMANENT_ERROR_CODES.includes(code)) return { ok: false, reason: `"${code}" is a permanent failure — correct the configuration first` };
  return { ok: true };
}

// Exponential backoff with a cap, in seconds, based on the attempt about to be made (1-based).
export function backoffSeconds(nextAttempt: number, capSeconds = 3600, baseSeconds = 60): number {
  const n = Math.max(1, Math.floor(nextAttempt));
  return Math.min(capSeconds, baseSeconds * Math.pow(2, n - 1));
}

export interface PayrollRetryInput { reason?: unknown }
export type PayrollRetryValidation = { ok: true; reason: string } | { ok: false; error: string };
export function validatePayrollRetry(input: PayrollRetryInput): PayrollRetryValidation {
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_PAYROLL_REASON_LEN) return { ok: false, error: `reason is required (at least ${MIN_PAYROLL_REASON_LEN} characters)` };
  return { ok: true, reason };
}

// Reconcile raw status counts into a stable summary. successRate is over terminal outcomes (synced vs failed) so
// in-flight/not-configured events don't distort it; null when there are no terminal events yet.
export function summarizePayrollSync(counts: { status: string; count: number }[]): {
  total: number; byStatus: Record<string, number>; successful: number; failed: number; successRate: number | null;
} {
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const c of counts || []) {
    const s = String(c.status || '').toLowerCase();
    const n = Number(c.count) || 0;
    byStatus[s] = (byStatus[s] || 0) + n;
    total += n;
  }
  const successful = byStatus['synced'] || 0;
  const failed = byStatus['failed'] || 0;
  const terminal = successful + failed;
  const successRate = terminal > 0 ? Math.round((successful / terminal) * 1000) / 10 : null;
  return { total, byStatus, successful, failed, successRate };
}
