// AI Insights report export. buildInsightsCsv is pure and testable; downloadCsv performs the browser side-effect.
// Field-level safety: no model chain-of-thought, hidden prompts, provider secrets, or unauthorized customer/payment
// detail — only the directory fields the user can already see. Confidence carries N/A when absent. Formula-injection
// safe (leading =,+,-,@ neutralized).
import type { AiInsightRow } from '../api/superAdminApi';

const HEADERS = ['Insight ID', 'Title', 'Tenant', 'Branch', 'Category', 'Severity', 'Confidence', 'Confidence Method', 'Recommendation', 'Status', 'Updated', 'Freshness'];

function safeCell(value: string | number | null | undefined): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildInsightsCsv(rows: AiInsightRow[], meta?: { filters?: Record<string, string>; generatedAt?: string }): string {
  const lines: string[] = [];
  lines.push(safeCell(`AI PowerSalon — AI Insights Report — generated ${meta?.generatedAt || new Date().toISOString()}`));
  lines.push(safeCell('Recommendations only — findings are not confirmed conclusions or executed actions.'));
  if (meta?.filters && Object.keys(meta.filters).some((k) => meta.filters![k])) {
    lines.push(safeCell('Filters: ' + Object.entries(meta.filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')));
  }
  lines.push(HEADERS.map(safeCell).join(','));
  for (const r of rows) {
    lines.push([
      r.reference, r.title, r.tenant, r.branch, r.category, r.severity,
      r.confidence == null ? 'N/A' : `${r.confidence}%`, r.confidenceMethod || '', r.recommendation || '',
      r.status, r.updatedAt ? new Date(r.updatedAt).toISOString() : '', r.freshness,
    ].map(safeCell).join(','));
  }
  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
