// billing-export-core.ts — pure CSV builder for accounting exports. Two hard guards: (1) spreadsheet formula-injection
// protection — any cell starting with = + - @ tab or CR is prefixed with a single quote; (2) a FORBIDDEN column guard —
// exports may never contain card/PAN/CVV/token/bank/account/secret/password or customer contact columns.

const FORBIDDEN = /(card|pan|cvv|cvc|token|secret|password|bank|account_number|routing|email|phone|ssn)/i;

export class ExportColumnError extends Error {}

export function sanitizeCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                 // formula-injection guard
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; // CSV quoting
  return s;
}

export function assertSafeColumns(columns: { key: string; label: string }[]): void {
  for (const c of columns) {
    if (FORBIDDEN.test(c.key) || FORBIDDEN.test(c.label)) throw new ExportColumnError(`Forbidden export column: ${c.key}`);
  }
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  assertSafeColumns(columns);
  const head = columns.map((c) => sanitizeCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => sanitizeCell(r[c.key])).join(',')).join('\n');
  return body ? `${head}\n${body}` : head;
}

const money = (c: unknown) => ((Number(c) || 0) / 100).toFixed(2);
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : '');

export const REPORTS: Record<string, { label: string; columns: { key: string; label: string }[]; map: (r: any) => Record<string, string> }> = {
  subscriptions: {
    label: 'Tenant Subscriptions',
    columns: [{ key: 'tenant', label: 'Tenant' }, { key: 'plan', label: 'Plan' }, { key: 'state', label: 'Status' }, { key: 'monthly', label: 'Monthly' }, { key: 'renewal', label: 'Renewal' }, { key: 'addOns', label: 'Add-Ons' }],
    map: (r) => ({ tenant: r.tenant ?? '', plan: r.plan ?? '', state: r.state ?? '', monthly: money(r.monthlyCents), renewal: dateOnly(r.renewalDate), addOns: String(r.addOns ?? 0) }),
  },
  invoices: {
    label: 'Invoices & Failed Payments',
    columns: [{ key: 'invoiceNumber', label: 'Invoice' }, { key: 'tenant', label: 'Tenant' }, { key: 'amount', label: 'Amount' }, { key: 'due', label: 'Due' }, { key: 'status', label: 'Payment Status' }, { key: 'retry', label: 'Retry Status' }],
    map: (r) => ({ invoiceNumber: r.invoiceNumber ?? '', tenant: r.tenant ?? '', amount: money(r.amountCents), due: dateOnly(r.dueDate), status: r.status ?? '', retry: r.retryStatus ?? '' }),
  },
  credits: {
    label: 'Credits',
    columns: [{ key: 'tenant', label: 'Tenant' }, { key: 'amount', label: 'Amount' }, { key: 'remaining', label: 'Remaining' }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status' }],
    map: (r) => ({ tenant: r.tenant ?? '', amount: money(r.amountCents), remaining: money(r.remainingCents), reason: r.reason ?? '', status: r.status ?? '' }),
  },
  discounts: {
    label: 'Discounts',
    columns: [{ key: 'tenant', label: 'Tenant' }, { key: 'code', label: 'Code' }, { key: 'type', label: 'Type' }, { key: 'value', label: 'Value' }, { key: 'status', label: 'Status' }],
    map: (r) => ({ tenant: r.tenant ?? 'All', code: r.code ?? '', type: r.discountType ?? '', value: r.discountType === 'percent' ? `${r.percent ?? 0}%` : money(r.amountCents), status: r.status ?? '' }),
  },
  'recurring-revenue': {
    label: 'Recurring Revenue',
    columns: [{ key: 'tenant', label: 'Tenant' }, { key: 'plan', label: 'Plan' }, { key: 'mrr', label: 'Monthly Recurring' }],
    map: (r) => ({ tenant: r.tenant ?? '', plan: r.plan ?? '', mrr: money(r.monthlyCents) }),
  },
};
