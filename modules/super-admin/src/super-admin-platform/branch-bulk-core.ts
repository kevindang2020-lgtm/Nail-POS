/**
 * branch-bulk-core.ts — pure, DB-free helpers for bulk branch actions (§27).
 *
 * Bulk operations require explicit selection, a confirmation, a required reason, permission verification (guard), and
 * audit logging. These helpers normalize the selected id list and validate a bulk status request; the repository applies
 * each branch individually (reusing the same per-branch transition validation + compare-and-swap as the single command),
 * so a bad branch never blocks the others and every outcome is reported. Pure → unit-tested without a database.
 */

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** Accept a string[] or comma-separated string; trim, drop empties, dedupe (preserving order). */
export function parseIdList(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : s(raw) ? s(raw).split(',') : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) { const id = s(v); if (id && !seen.has(id)) { seen.add(id); out.push(id); } }
  return out;
}

export interface BulkStatusInput { branchIds?: unknown; status?: unknown; reason?: unknown; }
export interface BulkStatusValue { branchIds: string[]; status: string; reason: string; }
export type BulkStatusValidation = { ok: true; value: BulkStatusValue } | { ok: false; errors: string[] };

export const BULK_SELECTION_LIMIT = 200;

export function validateBulkStatus(input: BulkStatusInput | undefined): BulkStatusValidation {
  const i = input || {};
  const errors: string[] = [];
  const branchIds = parseIdList(i.branchIds);
  if (branchIds.length === 0) errors.push('Select at least one branch.');
  if (branchIds.length > BULK_SELECTION_LIMIT) errors.push(`Too many branches selected (max ${BULK_SELECTION_LIMIT}).`);
  const status = s(i.status).toLowerCase();
  if (!status) errors.push('A target status is required.');
  const reason = s(i.reason);
  if (reason.length < 3) errors.push('A reason is required for a bulk status change.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { branchIds, status, reason } };
}

/** Roll up per-branch outcomes for the response + audit. */
export function summarizeBulk(results: { ok: boolean }[]): { total: number; succeeded: number; failed: number } {
  const total = results.length;
  const succeeded = results.filter((r) => r.ok).length;
  return { total, succeeded, failed: total - succeeded };
}
