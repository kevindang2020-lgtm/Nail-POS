// Customer import pipeline — pure, DB-free. Validates staged rows, summarizes a job, gates the lifecycle
// transitions (approve / retry / reject), and selects which rows a retry should re-process. Reuses the governance
// classifiers so import validity matches the rest of the module exactly.

import type { ImportJobStatus } from '@aipowersalon/api-contracts/platform';
export type { ImportJobStatus };   // owned by packages/api-contracts (Constitution 13 §13)
import { classifyPhone, classifyEmail } from './customer-data-governance-core';

export type ImportRowStatus = 'valid' | 'invalid' | 'imported' | 'failed';

export interface RawImportRow { rowNumber: number; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null }
export interface StagedRow { rowNumber: number; raw: RawImportRow; dedupKey: string; status: ImportRowStatus; error: string | null }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const digits = (s: unknown) => String(s ?? '').replace(/[^\d]/g, '');

/** Tenant-scoped natural key for a row: prefer phone digits, else email, else a name-based fallback. Used for
 *  in-job dedup (the unique index) so a retry can never double-stage or double-import the same person. */
export function dedupKeyFor(tenantId: string, row: RawImportRow): string {
  const phone = digits(row.phone);
  if (phone) return `${tenantId}|p|${phone}`;
  const email = norm(row.email);
  if (email) return `${tenantId}|e|${email}`;
  return `${tenantId}|n|${norm(row.firstName)} ${norm(row.lastName)}`.trim();
}

/** Validate + stage rows: classify each, mark invalid (with a reason) or valid, and drop in-batch duplicate keys
 *  to the first occurrence (later occurrences are invalid='duplicate in file'). */
export function stageRows(tenantId: string, rows: RawImportRow[]): StagedRow[] {
  const seen = new Set<string>();
  return rows.map((raw) => {
    const dedupKey = dedupKeyFor(tenantId, raw);
    const hasName = !!(norm(raw.firstName) || norm(raw.lastName));
    const phone = classifyPhone(raw.phone ?? null);
    const email = classifyEmail(raw.email ?? null);
    let status: ImportRowStatus = 'valid';
    let error: string | null = null;
    if (!hasName) { status = 'invalid'; error = 'Missing name'; }
    else if (phone === 'invalid') { status = 'invalid'; error = 'Invalid phone number'; }
    else if (email === 'invalid') { status = 'invalid'; error = 'Invalid email address'; }
    else if (phone === 'missing' && email === 'missing') { status = 'invalid'; error = 'No contact method (phone or email required)'; }
    else if (seen.has(dedupKey)) { status = 'invalid'; error = 'Duplicate of an earlier row in this file'; }
    if (status === 'valid') seen.add(dedupKey);
    return { rowNumber: raw.rowNumber, raw, dedupKey, status, error };
  });
}

export interface JobSummary { totalRows: number; validRows: number; invalidRows: number; importedRows: number; failedRows: number }
export function summarizeJob(rows: { status: ImportRowStatus }[]): JobSummary {
  return {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'valid').length,
    invalidRows: rows.filter((r) => r.status === 'invalid').length,
    importedRows: rows.filter((r) => r.status === 'imported').length,
    failedRows: rows.filter((r) => r.status === 'failed').length,
  };
}

/** A pending job with at least one valid (or already-imported) row can be approved. */
export function canApprove(status: ImportJobStatus, summary: JobSummary): { ok: boolean; reason?: string } {
  if (status !== 'pending') return { ok: false, reason: 'Only a pending job can be approved.' };
  if (summary.validRows + summary.importedRows === 0) return { ok: false, reason: 'No valid rows to import.' };
  return { ok: true };
}

/** Retry is allowed on a completed-with-failures or failed job, and only re-processes rows that are valid or
 *  failed — never rows already imported (idempotency). Returns the row numbers to re-run. */
export function canRetry(status: ImportJobStatus, rows: { rowNumber: number; status: ImportRowStatus }[]): { ok: boolean; reason?: string; retryRowNumbers: number[] } {
  if (status !== 'completed' && status !== 'failed') return { ok: false, reason: 'Only a completed or failed job can be retried.', retryRowNumbers: [] };
  const retry = rows.filter((r) => r.status === 'valid' || r.status === 'failed').map((r) => r.rowNumber);
  if (retry.length === 0) return { ok: false, reason: 'No retryable rows (all rows already imported or invalid).', retryRowNumbers: [] };
  return { ok: true, retryRowNumbers: retry };
}

export function importSuccessRate(summary: JobSummary): number | null {
  const attempted = summary.importedRows + summary.failedRows;
  if (attempted === 0) return null;
  return Math.round((summary.importedRows / attempted) * 1000) / 10;
}
