// Campaign report export. buildCampaignCsv is pure and testable; downloadCsv performs the browser side-effect.
// The directory rows are already Super-Admin authorized and contain NO customer-level data. Cells that could be
// interpreted as spreadsheet formulas are neutralized (formula-injection protection).
import type { McRow } from '../api/superAdminApi';

const HEADERS = ['Campaign ID', 'Name', 'Owner', 'Tenant', 'Branch', 'Channel', 'Audience Size', 'Delivery Rate', 'Open Rate', 'Click Rate', 'Bookings', 'Revenue (USD)', 'Scheduled', 'Status'];

// Neutralize leading =, +, -, @, tab, CR so spreadsheets don't execute cell content, then CSV-quote.
function safeCell(value: string | number | null | undefined): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCampaignCsv(rows: McRow[], meta?: { filters?: Record<string, string>; generatedAt?: string }): string {
  const lines: string[] = [];
  const gen = meta?.generatedAt || new Date().toISOString();
  lines.push(safeCell(`AI PowerSalon — Campaign Report — generated ${gen}`));
  if (meta?.filters && Object.keys(meta.filters).length) {
    lines.push(safeCell('Filters: ' + Object.entries(meta.filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ')));
  }
  lines.push(HEADERS.map(safeCell).join(','));
  for (const r of rows) {
    lines.push([
      r.reference, r.name, r.ownerType === 'platform' ? 'Platform' : 'Tenant', r.tenant, r.branch, r.channel,
      r.audienceSize, r.deliveryRateAvailable ? `${r.deliveryRate}%` : 'NotConnected', `${r.openRate}%`, `${r.clickRate}%`,
      r.bookingConversions, (r.revenueCents / 100).toFixed(2), r.scheduledAt ? new Date(r.scheduledAt).toISOString() : '', r.status,
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
