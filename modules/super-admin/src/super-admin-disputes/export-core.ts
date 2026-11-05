// export-core.ts — pure CSV building for chargeback report exports. No I/O. Security-first:
//  • Fixed safe column set — never card numbers, CVV, tokens, credentials, or evidence-file contents.
//  • Spreadsheet formula-injection protection: any cell beginning with = + - @ (or tab/CR) is prefixed with a single
//    quote so Excel/Sheets treat it as text, not a formula.
//  • Standard CSV quoting for commas/quotes/newlines.

export const CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'disputeReference', label: 'Dispute ID' },
  { key: 'amount', label: 'Dispute Amount' },
  { key: 'currency', label: 'Currency' },
  { key: 'reasonCode', label: 'Reason Code' },
  { key: 'reason', label: 'Reason' },
  { key: 'tenantName', label: 'Tenant' },
  { key: 'branchName', label: 'Branch' },
  { key: 'transactionRef', label: 'Transaction' },
  { key: 'responseDeadline', label: 'Response Deadline' },
  { key: 'status', label: 'Current Status' },
  { key: 'evidenceStatus', label: 'Evidence Status' },
  { key: 'processorDecision', label: 'Processor Decision' },
  { key: 'fundsWithdrawn', label: 'Funds Withdrawn' },
  { key: 'fundsRecovered', label: 'Funds Recovered' },
  { key: 'riskLevel', label: 'Risk Level' },
];
// Keys that must never appear in an export, enforced by a guard in toCsv.
const FORBIDDEN = /card(number|_number)?|\bpan\b|cvv|cvc|track|pin|token|credential|password|routing|account_number/i;

export function sanitizeCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // neutralize formula/command injection
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

// Map a dispute list row to safe, human-readable export values (money as dollars, deadline as a date). Never includes
// payment instrument data or evidence contents.
export function disputeToExportRecord(row: {
  disputeReference: string; amountCents: number; currency?: string; reasonCode: string | null; reason: string | null;
  tenantName: string; branchName: string | null; transactionRef: string | null; dueBy: string | null; status: string;
  evidenceStatus: string; processorDecision: string; fundsWithdrawnCents: number; fundsRecoveredCents: number; riskLevel: string;
}): Record<string, string> {
  const money = (c: number) => (c / 100).toFixed(2);
  return {
    disputeReference: row.disputeReference,
    amount: money(row.amountCents),
    currency: row.currency ?? 'USD',
    reasonCode: row.reasonCode ?? '',
    reason: row.reason ?? '',
    tenantName: row.tenantName,
    branchName: row.branchName ?? '',
    transactionRef: row.transactionRef ?? '',
    responseDeadline: row.dueBy ? row.dueBy.slice(0, 10) : '',
    status: row.status,
    evidenceStatus: row.evidenceStatus,
    processorDecision: row.processorDecision,
    fundsWithdrawn: money(row.fundsWithdrawnCents),
    fundsRecovered: money(row.fundsRecoveredCents),
    riskLevel: row.riskLevel,
  };
}

// Resolve the requested column keys to the safe column defs (defaults to all). Unknown/forbidden keys are dropped.
export function selectColumns(requested?: string[]): { key: string; label: string }[] {
  if (!requested || requested.length === 0) return CSV_COLUMNS;
  const set = new Set(requested);
  return CSV_COLUMNS.filter((c) => set.has(c.key));
}
