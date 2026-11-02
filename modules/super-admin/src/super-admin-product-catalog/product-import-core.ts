// Pure, DB-free engine for the product import pipeline: validate a staged row, classify its first error, summarize a
// job's counts into a status, decide retryability, and compute the import success rate. No fabrication, no side effects.

import { isValidUpc } from './product-master-core';

export interface ImportRowInput {
  name?: string | null;
  sku?: string | null;
  upc?: string | null;
  barcode?: string | null;
  categoryName?: string | null;
  priceCents?: number | null;
  brandName?: string | null;
}

export type ImportErrorType =
  | 'missing_required_field' | 'invalid_sku_format' | 'invalid_upc' | 'missing_category'
  | 'invalid_price' | 'missing_barcode' | 'duplicate_sku' | 'cross_tenant_reference' | 'file_security_failure';

// Errors that cannot be safely retried by re-running the same file (need resolution / are security failures).
export const NON_RETRYABLE: ReadonlySet<ImportErrorType> = new Set<ImportErrorType>(['file_security_failure', 'cross_tenant_reference', 'duplicate_sku']);
export const isRetryable = (t: ImportErrorType): boolean => !NON_RETRYABLE.has(t);

const isCents = (v: unknown): boolean => v == null || (Number.isInteger(v) && (v as number) >= 0);

/** Returns the FIRST blocking error for a staged row, or null if the row is valid. Order is deterministic. */
export function validateImportRow(row: ImportRowInput, opts: { requireBarcode?: boolean } = {}): ImportErrorType | null {
  if (!String(row.name ?? '').trim()) return 'missing_required_field';
  if (!String(row.categoryName ?? '').trim()) return 'missing_category';
  const sku = String(row.sku ?? '').trim();
  if (sku && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,49}$/.test(sku)) return 'invalid_sku_format';
  const upc = String(row.upc ?? '').trim();
  if (upc && !isValidUpc(upc)) return 'invalid_upc';
  if (!isCents(row.priceCents)) return 'invalid_price';
  if (opts.requireBarcode && !String(row.barcode ?? row.upc ?? '').trim()) return 'missing_barcode';
  return null;
}

export interface Classification { total: number; valid: number; invalid: number; errors: { rowNumber: number; name: string | null; errorType: ImportErrorType; retryable: boolean }[] }

export function classifyRows(rows: ImportRowInput[], opts: { requireBarcode?: boolean } = {}): Classification {
  const errors: Classification['errors'] = [];
  let valid = 0;
  rows.forEach((r, i) => {
    const e = validateImportRow(r, opts);
    if (e) errors.push({ rowNumber: i + 1, name: r.name ?? null, errorType: e, retryable: isRetryable(e) });
    else valid++;
  });
  return { total: rows.length, valid, invalid: errors.length, errors };
}

/** Pre-import status from a classification: all valid → ready; none valid → failed; mixed → ready (invalid rows are
 *  held out of the import). Post-import status is derived separately by summarizeImportResult. */
export function preImportStatus(c: Classification): 'ready' | 'failed' {
  if (c.total > 0 && c.valid === 0) return 'failed';
  return 'ready';
}

export function summarizeImportResult(importedRows: number, failedRows: number): 'imported' | 'partially_imported' | 'failed' {
  if (importedRows > 0 && failedRows === 0) return 'imported';
  if (importedRows > 0 && failedRows > 0) return 'partially_imported';
  return 'failed';
}

export interface JobLike { status: string; importedRows: number; failedRows: number }
export function importSuccessRate(jobs: JobLike[]): number | null {
  const denom = jobs.reduce((a, j) => a + j.importedRows + j.failedRows, 0);
  if (denom === 0) return null;
  const imported = jobs.reduce((a, j) => a + j.importedRows, 0);
  return Math.round((imported / denom) * 1000) / 10;
}
