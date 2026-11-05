// membership-export-core.ts — pure CSV building for membership report exports. Security-first, mirroring the disputes
// exporter: a fixed safe column set (never card numbers, CVV, tokens, or customer contact details), spreadsheet
// formula-injection protection, and standard CSV quoting. Money is rendered as dollars from integer cents.

export const CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'program', label: 'Program' },
  { key: 'tenant', label: 'Tenant' },
  { key: 'productType', label: 'Type' },
  { key: 'billingInterval', label: 'Billing Interval' },
  { key: 'price', label: 'Price' },
  { key: 'activeMembers', label: 'Active Members' },
  { key: 'totalMembers', label: 'Total Members' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'status', label: 'Status' },
];
// Never allow a column whose key/label implies payment instrument or personal contact data.
const FORBIDDEN = /card(number|_number)?|\bpan\b|cvv|cvc|track|pin|token|password|routing|account_number|email|phone|address|ssn/i;

export function sanitizeCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;               // neutralize formula/command injection
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`; // CSV-quote when needed
  return s;
}

export function toCsv(columns: { key: string; label: string }[], records: Record<string, unknown>[]): string {
  const bad = columns.find((c) => FORBIDDEN.test(c.key) || FORBIDDEN.test(c.label));
  if (bad) throw new Error(`Refusing to export a disallowed column: ${bad.key}`);
  const header = columns.map((c) => sanitizeCell(c.label)).join(',');
  const lines = records.map((r) => columns.map((c) => sanitizeCell(r[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

export function programToExportRecord(row: {
  name: string; tenantName: string; productType: string; billingInterval: string | null; priceCents: number;
  activeMembers: number; totalMembers: number; revenueCents: number; status: string;
}): Record<string, string> {
  const money = (c: number) => (c / 100).toFixed(2);
  return {
    program: row.name, tenant: row.tenantName, productType: row.productType, billingInterval: row.billingInterval ?? '',
    price: money(row.priceCents), activeMembers: String(row.activeMembers), totalMembers: String(row.totalMembers),
    revenue: money(row.revenueCents), status: row.status,
  };
}

export function selectColumns(requested?: string[]): { key: string; label: string }[] {
  if (!requested || requested.length === 0) return CSV_COLUMNS;
  const set = new Set(requested);
  return CSV_COLUMNS.filter((c) => set.has(c.key));
}

// ---- Additional §54 report types (all safe: no card/CVV/token/contact; member_number is a non-PII identifier) ----
export const BILLING_FAILURE_COLUMNS = [
  { key: 'tenant', label: 'Tenant' }, { key: 'program', label: 'Program' }, { key: 'memberNumber', label: 'Member' },
  { key: 'amount', label: 'Amount' }, { key: 'reason', label: 'Reason' }, { key: 'attempt', label: 'Attempt' }, { key: 'at', label: 'When' },
];
export const CANCELLATION_COLUMNS = [
  { key: 'tenant', label: 'Tenant' }, { key: 'program', label: 'Program' }, { key: 'memberNumber', label: 'Member' },
  { key: 'status', label: 'Status' }, { key: 'reason', label: 'Reason' }, { key: 'at', label: 'When' }, { key: 'resumesAt', label: 'Resumes' },
];
export const REVENUE_COLUMNS = [
  { key: 'tenant', label: 'Tenant' }, { key: 'revenue', label: 'Revenue' }, { key: 'mrr', label: 'MRR' },
];
export const SUSPICIOUS_COLUMNS = [
  { key: 'type', label: 'Signal' }, { key: 'tenant', label: 'Tenant' }, { key: 'count', label: 'Count' }, { key: 'severity', label: 'Severity' },
];

const money = (c: number) => ((c ?? 0) / 100).toFixed(2);
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export const billingFailureToRecord = (r: any): Record<string, string> => ({ tenant: r.tenant ?? '', program: r.program ?? '', memberNumber: r.memberNumber ?? '', amount: money(r.amountCents), reason: r.reason ?? '', attempt: String(r.attempt ?? ''), at: dateOnly(r.at) });
export const cancellationToRecord = (r: any): Record<string, string> => ({ tenant: r.tenant ?? '', program: r.program ?? '', memberNumber: r.memberNumber ?? '', status: r.status ?? '', reason: r.reason ?? '', at: dateOnly(r.at), resumesAt: dateOnly(r.resumesAt) });
export const revenueTenantToRecord = (r: any): Record<string, string> => ({ tenant: r.tenant ?? '', revenue: money(r.revenueCents), mrr: money(r.mrrCents) });
export const suspiciousToRecord = (r: any): Record<string, string> => ({ type: String(r.type ?? '').replace(/_/g, ' '), tenant: r.tenant ?? '', count: String(r.count ?? ''), severity: r.severity ?? '' });

export const REPORTS: Record<string, { label: string; columns: { key: string; label: string }[] }> = {
  programs: { label: 'Program Directory', columns: CSV_COLUMNS },
  'billing-failures': { label: 'Recurring Billing Failures', columns: BILLING_FAILURE_COLUMNS },
  cancellations: { label: 'Cancellation & Pause Activity', columns: CANCELLATION_COLUMNS },
  revenue: { label: 'Membership Revenue by Tenant', columns: REVENUE_COLUMNS },
  suspicious: { label: 'Suspicious / Duplicate Memberships', columns: SUSPICIOUS_COLUMNS },
};
