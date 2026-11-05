/**
 * branch-export-core.ts — pure, DB-free CSV builder for the server-side audited branch export (§44).
 *
 * The repository produces the full filtered+sorted directory set (no pagination); the service turns it into CSV with
 * these helpers and writes an audit event. Only monitoring columns are exported — no secrets, tokens, card data, or
 * unnecessary PII. Every cell is guarded against spreadsheet formula injection. Pure → unit-tested without a database.
 */
import type { BranchDirRow } from './branch-directory-core';

export const EXPORT_COLUMNS: { header: string; get: (b: BranchDirRow) => string | number }[] = [
  { header: 'Branch', get: (b) => b.name },
  { header: 'Branch ID', get: (b) => b.id },
  { header: 'Parent Tenant', get: (b) => b.tenantName || '' },
  { header: 'City', get: (b) => b.city || '' },
  { header: 'State', get: (b) => b.state || '' },
  { header: 'Latitude', get: (b) => (b.latitude == null ? '' : b.latitude) },
  { header: 'Longitude', get: (b) => (b.longitude == null ? '' : b.longitude) },
  { header: 'Manager', get: (b) => b.manager || '' },
  { header: 'Status', get: (b) => b.status },
  { header: 'Techs', get: (b) => b.staff },
  { header: 'Appts Today', get: (b) => b.todaysAppts },
  { header: 'Revenue MTD (USD)', get: (b) => (b.revenueMtdCents / 100).toFixed(2) },
  { header: 'Open Tickets', get: (b) => b.openTickets },
  { header: 'Queue Waiting', get: (b) => b.queueWaiting },
  { header: 'Health Score', get: (b) => (b.healthScore == null ? '' : b.healthScore) },
];

/** Neutralize spreadsheet formula injection: a leading =, +, -, or @ is prefixed with a single quote. */
export function guardCell(v: string | number): string {
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** CSV-escape a (formula-guarded) value. */
export function escapeCsv(v: string | number): string {
  const s = guardCell(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Build the full CSV (header + rows) from the directory set. */
export function rowsToCsv(rows: BranchDirRow[]): string {
  const header = EXPORT_COLUMNS.map((c) => c.header).join(',');
  const lines = rows.map((b) => EXPORT_COLUMNS.map((c) => escapeCsv(c.get(b))).join(','));
  return [header, ...lines].join('\n');
}
